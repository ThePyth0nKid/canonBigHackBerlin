/**
 * Magic-link signing + Resend email dispatch for /decide Stage-1 asks.
 *
 * Token shape: HMAC-SHA256 over `${threadId}.${as}.${exp}` using
 * MAGIC_LINK_SECRET (32-byte hex). Base64url-encoded. URL params:
 *
 *   /decide?thread=<id>&as=<email>&exp=<ms>&sig=<base64url>
 *
 * Verification is just signature check + expiry — no JTI table, no
 * one-time consumption. recordResponse() in decide.ts is already
 * idempotent (replay just adds a duplicate signed event the consensus
 * evaluator absorbs). Sufficient for the demo; JTI is V2.
 *
 * Routing decision: emails go to plus-addressed `nelson+<localpart>@
 * <ownDomain>` so RFC 6761-reserved persona addresses (alice@inazuma.example)
 * don't hard-bounce and degrade Resend's domain reputation. The audit
 * trail records both the persona (logical addressee) and the SMTP
 * recipient, so canon_cite stays honest.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Resend } from 'resend';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const FROM_DEFAULT = 'Canon <decide@ultranova.io>';
const RELAY_LOCAL_DEFAULT = 'nelson';

function getSecret(): string {
  const s = process.env.MAGIC_LINK_SECRET || process.env.CANON_SIGNER_KEY_HEX;
  if (!s) throw new Error('MAGIC_LINK_SECRET (or fallback CANON_SIGNER_KEY_HEX) not set');
  return s;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromBase64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export interface MagicTokenInput {
  threadId: string;
  as: string;
  /** Unix-ms expiry. Defaults to now + 24h. */
  exp?: number;
}

export interface MagicLinkUrlParts {
  thread: string;
  as: string;
  exp: string;
  sig: string;
}

export function signMagicToken(input: MagicTokenInput): MagicLinkUrlParts {
  const exp = (input.exp ?? Date.now() + TOKEN_TTL_MS).toString();
  const payload = `${input.threadId}.${input.as.toLowerCase()}.${exp}`;
  const sig = createHmac('sha256', getSecret()).update(payload).digest();
  return {
    thread: input.threadId,
    as: input.as.toLowerCase(),
    exp,
    sig: base64url(sig),
  };
}

export type MagicTokenVerifyResult =
  | { ok: true; threadId: string; as: string }
  | { ok: false; reason: 'missing_params' | 'expired' | 'bad_signature' };

export function verifyMagicToken(params: {
  thread?: string | null;
  as?: string | null;
  exp?: string | null;
  sig?: string | null;
}): MagicTokenVerifyResult {
  const { thread, as, exp, sig } = params;
  if (!thread || !as || !exp || !sig) return { ok: false, reason: 'missing_params' };
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return { ok: false, reason: 'expired' };

  const payload = `${thread}.${as.toLowerCase()}.${exp}`;
  const expected = createHmac('sha256', getSecret()).update(payload).digest();
  let provided: Buffer;
  try {
    provided = fromBase64url(sig);
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  if (provided.length !== expected.length) return { ok: false, reason: 'bad_signature' };
  if (!timingSafeEqual(provided, expected)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, threadId: thread, as: as.toLowerCase() };
}

/**
 * Build a magic-link URL for a given thread + persona.
 * baseUrl should NOT have trailing slash, e.g. "https://canon.ultranova.io".
 */
export function buildMagicLinkUrl(baseUrl: string, parts: MagicLinkUrlParts): string {
  const q = new URLSearchParams({
    thread: parts.thread,
    as: parts.as,
    exp: parts.exp,
    sig: parts.sig,
  });
  return `${baseUrl.replace(/\/+$/, '')}/decide?${q.toString()}`;
}

// ============================================================
// Resend send
// ============================================================

export interface AskEmailRecipient {
  /** Logical persona email — appears in UI and audit ("Acting as alice@…"). */
  personaEmail: string;
  /** Display name if the persona has a User row. */
  personaName?: string;
}

export interface SendAskEmailsArgs {
  threadId: string;
  entity: string;
  metricKey: string;
  /** Display lines like "€127,000 (slack · alice)". For email body context. */
  candidateLines: string[];
  recipients: AskEmailRecipient[];
  baseUrl: string;
}

export interface SendAskEmailsResult {
  attempted: number;
  sent: number;
  failed: { personaEmail: string; error: string }[];
}

/**
 * Fire-and-forget email send. Returns a result struct for audit
 * annotation but does NOT throw — call sites must continue regardless
 * of email outcome (the FactEvent ask is already committed by the time
 * this runs).
 */
export async function sendAskEmails(args: SendAskEmailsArgs): Promise<SendAskEmailsResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      attempted: args.recipients.length,
      sent: 0,
      failed: args.recipients.map((r) => ({
        personaEmail: r.personaEmail,
        error: 'RESEND_API_KEY not set',
      })),
    };
  }
  const resend = new Resend(apiKey);
  const from = process.env.CANON_DECIDE_FROM ?? FROM_DEFAULT;
  const relayDomain = process.env.EMAIL_FROM_DOMAIN ?? 'ultranova.io';
  const relayLocal = process.env.CANON_DECIDE_RELAY_LOCAL ?? RELAY_LOCAL_DEFAULT;

  const result: SendAskEmailsResult = {
    attempted: args.recipients.length,
    sent: 0,
    failed: [],
  };

  for (const r of args.recipients) {
    const localPart = r.personaEmail.split('@')[0] || 'persona';
    // Plus-addressing: nelson+alice@ultranova.io. RFC 5233 — receiver
    // sees only the base mailbox, persona token survives in the address.
    const smtpTo = `${relayLocal}+${localPart}@${relayDomain}`;

    const tokenParts = signMagicToken({ threadId: args.threadId, as: r.personaEmail });
    const link = buildMagicLinkUrl(args.baseUrl, tokenParts);

    const subject = `Canon: please confirm ${args.entity}.${args.metricKey} (asked of ${r.personaEmail})`;
    const html = renderHtml({
      personaEmail: r.personaEmail,
      personaName: r.personaName,
      entity: args.entity,
      metricKey: args.metricKey,
      candidateLines: args.candidateLines,
      link,
    });
    const text = renderText({
      personaEmail: r.personaEmail,
      entity: args.entity,
      metricKey: args.metricKey,
      candidateLines: args.candidateLines,
      link,
    });

    try {
      const sendRes = await resend.emails.send({
        from,
        to: smtpTo,
        replyTo: from,
        subject,
        html,
        text,
        headers: {
          'X-Canon-Thread': args.threadId,
          'X-Canon-Persona': r.personaEmail,
        },
      });
      if (sendRes.error) {
        result.failed.push({ personaEmail: r.personaEmail, error: sendRes.error.message });
      } else {
        result.sent += 1;
      }
    } catch (e) {
      result.failed.push({
        personaEmail: r.personaEmail,
        error: (e as Error).message,
      });
    }
    // Resend free tier is 2 sends / second. Polite spacing.
    await sleep(300);
  }

  return result;
}

function renderHtml(args: {
  personaEmail: string;
  personaName?: string;
  entity: string;
  metricKey: string;
  candidateLines: string[];
  link: string;
}): string {
  const name = args.personaName ?? args.personaEmail;
  const claimsList = args.candidateLines
    .map((c) => `<li style="margin: 4px 0;"><code>${escapeHtml(c)}</code></li>`)
    .join('');
  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 12px;">Canon needs your input</h2>
  <p style="font-size: 14px; margin: 0 0 16px;">
    Hi ${escapeHtml(name)} —<br/>
    Two of your colleagues' systems disagree about
    <strong style="font-family: ui-monospace, monospace;">${escapeHtml(args.entity)}.${escapeHtml(args.metricKey)}</strong>.
    You're listed as a source on this fact, so we'd like you to settle it.
  </p>
  <p style="font-size: 13px; margin: 0 0 8px; color: #6b7280;">Competing claims:</p>
  <ul style="font-size: 13px; margin: 0 0 20px; padding-left: 20px;">${claimsList}</ul>
  <p style="margin: 0 0 24px;">
    <a href="${args.link}" style="display: inline-block; background: #0ea5e9; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
      Open Canon to respond →
    </a>
  </p>
  <p style="font-size: 11px; color: #9ca3af; margin: 16px 0 0;">
    Your answer is signed (Ed25519) and joins the same hash-chained ledger every Canon agent reads from.
    Link expires in 24 hours.
  </p>
</body>
</html>`;
}

function renderText(args: {
  personaEmail: string;
  entity: string;
  metricKey: string;
  candidateLines: string[];
  link: string;
}): string {
  return [
    `Canon needs your input on ${args.entity}.${args.metricKey}.`,
    '',
    'Competing claims:',
    ...args.candidateLines.map((c) => `  - ${c}`),
    '',
    `Open Canon to respond:  ${args.link}`,
    '',
    'Your answer is signed and joins the same hash-chained ledger every Canon agent reads from. Link expires in 24h.',
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
