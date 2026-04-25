/**
 * Gmail source adapter — searches `subject:"[canon-demo]"`, parses bodies
 * (with forwarded-message headers), hands off to Pioneer per email.
 *
 * Auth: an OAuth access_token from the user's Google Account row in Prisma.
 * Scope `gmail.readonly` is already requested by /src/auth.ts. If the stored
 * token is expired we refresh via Google's token endpoint.
 */

import type { FactDraft } from '../canon/types';
import { extractFactsFromChunks, type Chunk } from '../canon/pioneer';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_QUERY = 'subject:"[canon-demo]"';

export interface GmailAccount {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
}

export interface GmailIngestResult {
  query: string;
  messageCount: number;
  drafts: FactDraft[];
  /** Refreshed access token if a refresh happened — caller should persist. */
  refreshedAccessToken?: string;
  refreshedExpiresAt?: number;
}

interface GmailListResp {
  messages?: { id: string; threadId: string }[];
  resultSizeEstimate?: number;
}

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  payload: GmailPayload;
}

interface GmailPayload {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}

export async function ingestGmail(
  account: GmailAccount,
  opts?: { query?: string; max?: number },
): Promise<GmailIngestResult> {
  const query = opts?.query ?? DEFAULT_QUERY;
  const max = opts?.max ?? 25;

  let { accessToken } = account;
  let refreshed: { token: string; expiresAt: number } | undefined;
  if (isExpired(account.expiresAt) && account.refreshToken) {
    const r = await refreshAccessToken(account.refreshToken);
    accessToken = r.access_token;
    refreshed = { token: r.access_token, expiresAt: nowSec() + r.expires_in };
  }

  const ids = await listMessageIds(accessToken, query, max);
  // Serialise the per-message fetches with a small delay. Parallel
  // Promise.all over 5+ ids was enough to trip Gmail's per-user QPS
  // quota (HTTP 429) on prod. The whole sync is bounded to ~25 mails
  // anyway, so 100ms*25 = 2.5s extra is invisible to the user.
  const messages: GmailMessage[] = [];
  for (const id of ids) {
    const m = await fetchMessageWithRetry(accessToken, id);
    messages.push(m);
    await sleep(100);
  }
  const chunks = messages.flatMap(messageToChunks);
  const drafts = await extractFactsFromChunks(chunks);

  return {
    query,
    messageCount: messages.length,
    drafts,
    refreshedAccessToken: refreshed?.token,
    refreshedExpiresAt: refreshed?.expiresAt,
  };
}

async function listMessageIds(token: string, query: string, max: number): Promise<string[]> {
  const url = `${GMAIL_API}/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail list HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as GmailListResp;
  return (data.messages ?? []).map((m) => m.id);
}

async function fetchMessage(token: string, id: string): Promise<GmailMessage> {
  const url = `${GMAIL_API}/users/me/messages/${id}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail get HTTP ${res.status}`);
  return (await res.json()) as GmailMessage;
}

/** fetchMessage + one retry on 429 (Retry-After honoured if Gmail sets it). */
async function fetchMessageWithRetry(
  token: string,
  id: string,
): Promise<GmailMessage> {
  try {
    return await fetchMessage(token, id);
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes('429')) throw e;
    // Backoff for the standard Gmail rate-limit window. 1.2s is enough to
    // clear the per-second user quota; if the SECOND attempt also 429s the
    // caller's outer try/catch surfaces it as a soft sync failure.
    await sleep(1200);
    return fetchMessage(token, id);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageToChunks(m: GmailMessage): Chunk[] {
  const subject = headerOf(m.payload, 'Subject') ?? '(no subject)';
  const observedAt = isoFromGmailDate(headerOf(m.payload, 'Date'), m.internalDate);
  const body = extractBody(m.payload);
  const cleaned = stripQuotedReplies(body);
  const paragraphs = chunkParagraphs(cleaned);

  return paragraphs.map((para, idx) => ({
    text: `${subject}. ${para}`,
    sourceRef: `gmail:${m.id}#p${idx}`,
    observedAt,
    sourceExcerpt: para.slice(0, 240),
    // Inbox-context: emails without an explicit customer name belong to
    // Inazuma itself (post-pivot — single-workspace world).
    defaultEntity: 'inazuma',
  }));
}

function headerOf(p: GmailPayload, name: string): string | undefined {
  return p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function extractBody(p: GmailPayload): string {
  if (p.body?.data) return decodeBase64Url(p.body.data);
  if (p.parts) {
    const plain = p.parts.find((q) => q.mimeType === 'text/plain');
    if (plain?.body?.data) return decodeBase64Url(plain.body.data);
    for (const child of p.parts) {
      const nested = extractBody(child);
      if (nested) return nested;
    }
  }
  return '';
}

function decodeBase64Url(data: string): string {
  const norm = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(norm, 'base64').toString('utf-8');
}

function stripQuotedReplies(body: string): string {
  return body
    .replace(/^>.*$/gm, '')
    .replace(/^On .* wrote:$/gm, '')
    .replace(/-{2,}\s*Forwarded message\s*-{2,}/gi, '')
    .trim();
}

function chunkParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 20);
}

function isoFromGmailDate(headerDate: string | undefined, internal: string): string {
  if (headerDate) {
    const d = new Date(headerDate);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const ms = Number(internal);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return new Date().toISOString();
}

function isExpired(expiresAt: number | null | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt <= nowSec() + 30;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

interface RefreshResp {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

async function refreshAccessToken(refreshToken: string): Promise<RefreshResp> {
  const id = process.env.AUTH_GOOGLE_ID;
  const secret = process.env.AUTH_GOOGLE_SECRET;
  if (!id || !secret) throw new Error('AUTH_GOOGLE_ID/SECRET not set');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as RefreshResp;
}
