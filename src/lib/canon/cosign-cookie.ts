/**
 * Cosign-cookie — the RBAC anchor for 4-eyes magic-link landings.
 *
 * Mirrors persona-cookie.ts in shape (HMAC-signed, httpOnly, 30min TTL)
 * but carries a different payload tuned to the cosign flow:
 *
 *   { resolutionFactId, asEmail, exp }
 *
 * Set by /app/cosign route handler after a magic-link token verifies.
 * Read by:
 *   - /app page server component → highlights the matching pending row
 *   - coSignResolution server action → authorises a cosign call when the
 *     viewer is NOT signed in via OAuth but IS a magic-link recipient.
 *     The asEmail must still pass the CANON_ADMIN_EMAILS gate.
 *
 * Security model — V1 (demo):
 *   - Same MAGIC_LINK_SECRET as persona-cookie / decide-mail.
 *   - HMAC over `${resolutionFactId}.${asEmail.toLowerCase()}.${exp}`.
 *   - The cookie alone authorises a SPECIFIC resolutionFactId co-sign as
 *     `asEmail`, time-limited. Cannot be repurposed for other resolutions
 *     because the resolutionFactId is part of the signed payload.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'canon_cosign';
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

interface CosignPayload {
  resolutionFactId: string;
  asEmail: string;
  exp: number;
}

function sign(payload: CosignPayload): string {
  const data = `${payload.resolutionFactId}.${payload.asEmail.toLowerCase()}.${payload.exp}`;
  const sig = createHmac('sha256', getSecret()).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

function verify(value: string): CosignPayload | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [resolutionFactId, asEmail, expStr, sigB64] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;
  const data = `${resolutionFactId}.${asEmail}.${expStr}`;
  const expected = createHmac('sha256', getSecret()).update(data).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sigB64);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  return { resolutionFactId, asEmail, exp };
}

export interface CosignContext {
  resolutionFactId: string;
  asEmail: string;
  exp: number;
}

export async function setCosignCookie(args: {
  resolutionFactId: string;
  asEmail: string;
}): Promise<void> {
  const exp = Date.now() + TTL_MS;
  const value = sign({
    resolutionFactId: args.resolutionFactId,
    asEmail: args.asEmail.toLowerCase(),
    exp,
  });
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

export async function readCosignContext(): Promise<CosignContext | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verify(raw);
}

/** Convenience for /app page — returns just the resolutionFactId to highlight,
 *  null if no valid cookie. */
export async function readCosignFocusCookie(): Promise<string | null> {
  const ctx = await readCosignContext();
  return ctx?.resolutionFactId ?? null;
}

export async function clearCosignCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
