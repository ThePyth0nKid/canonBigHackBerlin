/**
 * Persona cookie — server-side RBAC anchor for the /decide flow.
 *
 * When a recipient lands via a verified magic-link, we set an HMAC-signed
 * httpOnly cookie carrying { threadId, as, exp }. Subsequent server actions
 * read this cookie to determine whether the request is acting as the
 * workspace owner (admin) or as a routed persona (source-author scoped to
 * one thread).
 *
 * Why a cookie instead of re-passing the URL token: server actions in the
 * App Router are POSTs from client onClick handlers — passing the token
 * through every action call would require threading it through every
 * component. The cookie persists across the magic-link recipient's session
 * (30min) and gets cleared by an explicit "Exit persona" action.
 *
 * Security model — V1 (demo):
 *   - Owner identity = OAuth session user (Google).
 *   - Persona identity = HMAC-signed cookie value.
 *   - Owner without cookie = full admin (ask, escalate, resolve, decide).
 *   - Owner with cookie = persona scope (only respond to their thread).
 *   - The cookie is the SOLE differentiator between admin and persona,
 *     since both are nominally on the same OAuth session for the demo.
 *   - Anyone who can forge an HMAC with MAGIC_LINK_SECRET could impersonate
 *     a persona; that secret is never sent to clients.
 *
 * V2 hardening: real per-persona OAuth identities, role tables in DB.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'canon_persona';
const TTL_MS = 30 * 60 * 1000;

function getSecret(): string {
  const s = process.env.MAGIC_LINK_SECRET || process.env.CANON_SIGNER_KEY_HEX;
  if (!s) throw new Error('MAGIC_LINK_SECRET (or fallback CANON_SIGNER_KEY_HEX) not set');
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

interface PersonaPayload {
  threadId: string;
  as: string;
  exp: number;
}

function sign(payload: PersonaPayload): string {
  const data = `${payload.threadId}.${payload.as.toLowerCase()}.${payload.exp}`;
  const sig = createHmac('sha256', getSecret()).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

function verify(value: string): PersonaPayload | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [threadId, as, expStr, sigB64] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;
  const data = `${threadId}.${as}.${expStr}`;
  const expected = createHmac('sha256', getSecret()).update(data).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sigB64);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  return { threadId, as, exp };
}

export interface PersonaContext {
  threadId: string;
  as: string;
  exp: number;
}

/**
 * Set the persona cookie. Caller MUST be in a server-action / route-handler
 * context (cookies().set is only writable there in App Router).
 */
export async function setPersonaCookie(args: {
  threadId: string;
  as: string;
}): Promise<void> {
  const exp = Date.now() + TTL_MS;
  const value = sign({ threadId: args.threadId, as: args.as.toLowerCase(), exp });
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

/**
 * Read + verify the persona cookie. Returns null if absent / invalid /
 * expired. Safe to call from any server context (page server component,
 * server action, route handler).
 */
export async function readPersonaContext(): Promise<PersonaContext | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verify(raw);
}

export async function clearPersonaCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
