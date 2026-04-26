/**
 * Magic-link signing + Resend dispatch for 4-eyes co-sign requests.
 *
 * Mirrors decide-mail.ts in shape but for the cosign flow:
 *
 *   /app/cosign?res=<id>&as=<email>&exp=<ms>&sig=<base64url>
 *
 * Token = HMAC-SHA256 over `${resolutionFactId}.${as.toLowerCase()}.${exp}`
 * using MAGIC_LINK_SECRET — the same secret /decide already requires.
 *
 * Routing decision: emails go to a single demo inbox
 * (CANON_DEMO_TO / CANON_DECIDE_DEMO_TO, default nelson@ultranova.io)
 * so the operator can show the inbox + the click-through live on stage.
 * The intended cosigner identity rides in (a) the subject prefix
 * `[for cosigner@…]`, (b) an in-body banner, and (c) the magic-link
 * token itself — when the link is clicked, the /app/cosign route sets
 * canon_cosign cookie tied to that exact resolutionFactId + email,
 * which the cosignResolution server action reads as the audit anchor.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Resend } from 'resend';
import { adminEmails } from './admin';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const FROM_DEFAULT = 'Canon <decide@ultranova.io>';
const DEMO_RECIPIENT_DEFAULT = 'nelson@ultranova.io';

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

export interface CosignTokenInput {
  resolutionFactId: string;
  asEmail: string;
  exp?: number;
}

export interface CosignTokenParts {
  res: string;
  as: string;
  exp: string;
  sig: string;
}

export function signCosignToken(input: CosignTokenInput): CosignTokenParts {
  const exp = (input.exp ?? Date.now() + TOKEN_TTL_MS).toString();
  const data = `${input.resolutionFactId}.${input.asEmail.toLowerCase()}.${exp}`;
  const sig = createHmac('sha256', getSecret()).update(data).digest();
  return {
    res: input.resolutionFactId,
    as: input.asEmail.toLowerCase(),
    exp,
    sig: b64url(sig),
  };
}

export type CosignVerifyResult =
  | { ok: true; resolutionFactId: string; asEmail: string }
  | { ok: false; reason: 'missing_params' | 'expired' | 'bad_signature' };

export function verifyCosignToken(params: {
  res?: string | null;
  as?: string | null;
  exp?: string | null;
  sig?: string | null;
}): CosignVerifyResult {
  const { res, as, exp, sig } = params;
  if (!res || !as || !exp || !sig) return { ok: false, reason: 'missing_params' };
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return { ok: false, reason: 'expired' };
  const data = `${res}.${as.toLowerCase()}.${exp}`;
  const expected = createHmac('sha256', getSecret()).update(data).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sig);
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  if (provided.length !== expected.length) return { ok: false, reason: 'bad_signature' };
  if (!timingSafeEqual(provided, expected)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, resolutionFactId: res, asEmail: as.toLowerCase() };
}

export function buildCosignMagicUrl(baseUrl: string, parts: CosignTokenParts): string {
  const q = new URLSearchParams({
    res: parts.res,
    as: parts.as,
    exp: parts.exp,
    sig: parts.sig,
  });
  return `${baseUrl.replace(/\/+$/, '')}/app/cosign?${q.toString()}`;
}

// ============================================================
// Resend send
// ============================================================

export interface SendCosignRequestArgs {
  resolutionFactId: string;
  /** Initiator email — recorded in the email body so the cosigner sees who proposed. */
  initiatorEmail: string;
  /** All admin emails ≠ initiator; one email is sent per recipient. */
  recipientEmails: string[];
  entity: string;
  entityDisplay: string;
  metricKey: string;
  metricValue: string;
  metricUnit?: string | null;
  willSupersedeCount: number;
  baseUrl: string;
}

export interface SendCosignRequestResult {
  attempted: number;
  sent: number;
  failed: { email: string; error: string }[];
}

/**
 * Fire-and-forget. Returns a result struct for audit annotation but
 * does NOT throw — the resolveConflict call site continues regardless,
 * because the pending FactEvent is already on the chain by the time
 * this runs.
 */
export async function sendCosignRequestEmails(
  args: SendCosignRequestArgs,
): Promise<SendCosignRequestResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      attempted: args.recipientEmails.length,
      sent: 0,
      failed: args.recipientEmails.map((e) => ({ email: e, error: 'RESEND_API_KEY not set' })),
    };
  }
  const resend = new Resend(apiKey);
  const from = process.env.CANON_DECIDE_FROM ?? FROM_DEFAULT;
  const demoRecipient =
    process.env.CANON_DECIDE_DEMO_TO ??
    process.env.CANON_DEMO_TO ??
    DEMO_RECIPIENT_DEFAULT;

  const result: SendCosignRequestResult = {
    attempted: args.recipientEmails.length,
    sent: 0,
    failed: [],
  };

  for (const cosignerEmail of args.recipientEmails) {
    const tokenParts = signCosignToken({
      resolutionFactId: args.resolutionFactId,
      asEmail: cosignerEmail,
    });
    const link = buildCosignMagicUrl(args.baseUrl, tokenParts);

    const subject = `[for ${cosignerEmail}] 4-eyes co-sign needed: ${args.entityDisplay} ${args.metricKey} = ${args.metricValue}`;
    const html = renderHtml({
      cosignerEmail,
      initiatorEmail: args.initiatorEmail,
      entityDisplay: args.entityDisplay,
      entity: args.entity,
      metricKey: args.metricKey,
      metricValue: args.metricValue,
      metricUnit: args.metricUnit ?? null,
      willSupersedeCount: args.willSupersedeCount,
      link,
    });
    const text = renderText({
      cosignerEmail,
      initiatorEmail: args.initiatorEmail,
      entityDisplay: args.entityDisplay,
      metricKey: args.metricKey,
      metricValue: args.metricValue,
      willSupersedeCount: args.willSupersedeCount,
      link,
    });

    try {
      const sendRes = await resend.emails.send({
        from,
        to: demoRecipient,
        replyTo: from,
        subject,
        html,
        text,
        headers: {
          'X-Canon-Resolution': args.resolutionFactId,
          'X-Canon-Cosigner': cosignerEmail,
          'X-Canon-Kind': 'cosign-request',
        },
      });
      if (sendRes.error) {
        result.failed.push({ email: cosignerEmail, error: sendRes.error.message });
      } else {
        result.sent += 1;
      }
    } catch (e) {
      result.failed.push({ email: cosignerEmail, error: (e as Error).message });
    }
    await sleep(300);
  }

  return result;
}

/**
 * Convenience: pull recipient list from CANON_ADMIN_EMAILS env, drop
 * the initiator. Returns empty array if env is unset or only contains
 * the initiator.
 */
export function pickCosignRecipients(initiatorEmail: string): string[] {
  const all = adminEmails();
  if (all.length === 0) return [];
  const init = initiatorEmail.toLowerCase();
  return all.filter((e) => e.toLowerCase() !== init);
}

// ============================================================
// HTML / Text rendering
// ============================================================

function renderHtml(args: {
  cosignerEmail: string;
  initiatorEmail: string;
  entityDisplay: string;
  entity: string;
  metricKey: string;
  metricValue: string;
  metricUnit: string | null;
  willSupersedeCount: number;
  link: string;
}): string {
  const value = args.metricUnit ? `${args.metricValue} ${args.metricUnit}` : args.metricValue;
  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <div style="background: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 11px; font-family: ui-monospace, monospace; color: #6d28d9; text-transform: uppercase; letter-spacing: 0.08em;">
      4-eyes co-sign request
    </p>
    <p style="margin: 2px 0 0; font-size: 15px; font-weight: 600; color: #4c1d95;">
      For ${escapeHtml(args.cosignerEmail)}
    </p>
  </div>
  <h2 style="font-size: 18px; margin: 0 0 12px;">A high-risk pick needs your second signature</h2>
  <p style="font-size: 14px; margin: 0 0 14px;">
    <strong>${escapeHtml(args.initiatorEmail)}</strong> proposed canonical truth on
    <strong style="font-family: ui-monospace, monospace;">${escapeHtml(args.entityDisplay)} · ${escapeHtml(args.metricKey)}</strong>.
    Because this metric is high-risk (revenue / contract / churn class),
    the proposal is signed as <em>resolution-pending</em> and won't
    supersede the alternatives until a different admin co-signs.
  </p>
  <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 12px; color: #6b7280;">Proposed value</p>
    <p style="margin: 2px 0 0; font-size: 22px; font-weight: 600; font-family: ui-monospace, monospace; color: #111827;">
      ${escapeHtml(value)}
    </p>
    <p style="margin: 8px 0 0; font-size: 12px; color: #6b7280;">
      ${args.willSupersedeCount} fact${args.willSupersedeCount === 1 ? '' : 's'} will flip to <code>superseded</code> the moment you co-sign.
    </p>
  </div>
  <p style="margin: 0 0 24px;">
    <a href="${args.link}" style="display: inline-block; background: #6d28d9; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
      Review &amp; co-sign on Canon →
    </a>
  </p>
  <p style="font-size: 11px; color: #9ca3af; margin: 16px 0 0;">
    Both your signature and the original proposal are Ed25519-signed and join
    the same hash-chained ledger every Canon agent reads from. The pending
    proposal is already on the chain — your co-sign converts it to canonical.
    Link expires in 24 hours.
  </p>
</body>
</html>`;
}

function renderText(args: {
  cosignerEmail: string;
  initiatorEmail: string;
  entityDisplay: string;
  metricKey: string;
  metricValue: string;
  willSupersedeCount: number;
  link: string;
}): string {
  return [
    `4-eyes co-sign requested for ${args.cosignerEmail}.`,
    '',
    `${args.initiatorEmail} proposed canonical truth on ${args.entityDisplay} · ${args.metricKey} = ${args.metricValue}.`,
    `${args.willSupersedeCount} fact${args.willSupersedeCount === 1 ? '' : 's'} will flip to superseded once you co-sign.`,
    '',
    `Review and co-sign:  ${args.link}`,
    '',
    'Both signatures are Ed25519-signed and join the same hash-chained ledger every Canon agent reads from. Link expires in 24h.',
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
