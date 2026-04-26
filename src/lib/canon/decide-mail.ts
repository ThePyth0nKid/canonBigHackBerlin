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
/** Demo recipient. Every magic-link email lands here so the operator can
 *  show the inbox + the click-through live on stage. The persona identity
 *  is preserved in the subject prefix and a visible banner inside the
 *  body — and most importantly, in the magic-link token itself, so when
 *  the link is clicked /decide hydrates the right addressee identity for
 *  the audit trail. RFC 6761 `.example` persona addresses don't accept
 *  mail; routing all asks to a real inbox is what makes the demo work. */
const DEMO_RECIPIENT_DEFAULT = 'nelson@ultranova.io';

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
  // Land on /decide/enter — a server-side route handler verifies the
  // token, sets the persona cookie, and 302s to a clean /decide URL.
  // Cookie is the SOLE RBAC anchor; token never persists in browser
  // history or referrer headers.
  return `${baseUrl.replace(/\/+$/, '')}/decide/enter?${q.toString()}`;
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
  const demoRecipient =
    process.env.CANON_DECIDE_DEMO_TO ??
    process.env.CANON_DEMO_TO ??
    DEMO_RECIPIENT_DEFAULT;

  const result: SendAskEmailsResult = {
    attempted: args.recipients.length,
    sent: 0,
    failed: [],
  };

  for (const r of args.recipients) {
    // Direct send to a real inbox so the email actually arrives and can be
    // shown live on stage. Persona identity rides in the subject prefix
    // ("[for alice@inazuma.example]") and an in-body banner. The magic-link
    // token still carries the persona, so clicking lands on /decide with
    // the right "Acting as …" attribution.
    const smtpTo = demoRecipient;

    const tokenParts = signMagicToken({ threadId: args.threadId, as: r.personaEmail });
    const link = buildMagicLinkUrl(args.baseUrl, tokenParts);

    const subject = `[for ${r.personaEmail}] Canon needs your input on ${args.entity}.${args.metricKey}`;
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

// ============================================================
// Escalation notification email
//
// Fires on EVERY ask/escalate action, including the no-human-author
// case (escalateDirectly) where there's nobody to ask. Lets the demo
// audience see Canon emit a notification for every routing decision —
// both ask and escalate trigger an email so the on-stage flow is
// "click → email lands in inbox" with zero exceptions.
// ============================================================

export interface SendEscalationNotificationArgs {
  threadId: string;
  entity: string;
  metricKey: string;
  candidateLines: string[];
  /** Role the conflict was routed to (cfo / revops_lead / deal_owner). */
  role: string;
  /** Human-readable email of the role's authority (recorded in audit). */
  authorityEmail: string;
  /** Reason the email is being sent — drives subject and body copy. */
  kind: 'ask_skipped_no_authors' | 'escalation_after_divergence';
  baseUrl: string;
}

export interface SendNotificationResult {
  sent: boolean;
  error?: string;
}

export async function sendEscalationNotification(
  args: SendEscalationNotificationArgs,
): Promise<SendNotificationResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, error: 'RESEND_API_KEY not set' };

  const resend = new Resend(apiKey);
  const from = process.env.CANON_DECIDE_FROM ?? FROM_DEFAULT;
  const demoRecipient =
    process.env.CANON_DECIDE_DEMO_TO ??
    process.env.CANON_DEMO_TO ??
    DEMO_RECIPIENT_DEFAULT;

  // Magic-link with persona = the authority role's email, so when clicked
  // /decide can render the card scoped to "Acting as <role authority>".
  const tokenParts = signMagicToken({
    threadId: args.threadId,
    as: args.authorityEmail,
  });
  const link = buildMagicLinkUrl(args.baseUrl, tokenParts);

  const subjectKindLabel =
    args.kind === 'ask_skipped_no_authors'
      ? `escalated to ${args.role}`
      : `escalated to ${args.role} (authors diverged)`;
  const subject = `[for ${args.authorityEmail}] Canon ${subjectKindLabel}: ${args.entity}.${args.metricKey}`;

  const html = renderEscalationHtml({ ...args, link });
  const text = renderEscalationText({ ...args, link });

  try {
    const res = await resend.emails.send({
      from,
      to: demoRecipient,
      replyTo: from,
      subject,
      html,
      text,
      headers: {
        'X-Canon-Thread': args.threadId,
        'X-Canon-Kind': args.kind,
        'X-Canon-Role': args.role,
      },
    });
    if (res.error) return { sent: false, error: res.error.message };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

function renderEscalationHtml(args: SendEscalationNotificationArgs & { link: string }): string {
  const reason =
    args.kind === 'ask_skipped_no_authors'
      ? `All sources for this conflict are automated — there's no human author to ask. Canon routed it directly to <strong>${escapeHtml(args.role)}</strong>.`
      : `The source-authors couldn't agree, so Canon escalated this conflict to <strong>${escapeHtml(args.role)}</strong>.`;
  const claimsList = args.candidateLines
    .map((c) => `<li style="margin: 4px 0;"><code>${escapeHtml(c)}</code></li>`)
    .join('');
  return `<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 11px; font-family: ui-monospace, monospace; color: #c2410c; text-transform: uppercase; letter-spacing: 0.08em;">
      Escalated to · ${escapeHtml(args.role)}
    </p>
    <p style="margin: 2px 0 0; font-size: 15px; font-weight: 600; color: #7c2d12;">
      ${escapeHtml(args.authorityEmail)}
    </p>
  </div>
  <h2 style="font-size: 18px; margin: 0 0 12px;">Canon escalated a conflict to you</h2>
  <p style="font-size: 14px; margin: 0 0 16px;">
    ${reason} You need to pick canonical truth on
    <strong style="font-family: ui-monospace, monospace;">${escapeHtml(args.entity)}.${escapeHtml(args.metricKey)}</strong>.
  </p>
  <p style="font-size: 13px; margin: 0 0 8px; color: #6b7280;">Competing claims:</p>
  <ul style="font-size: 13px; margin: 0 0 20px; padding-left: 20px;">${claimsList}</ul>
  <p style="margin: 0 0 24px;">
    <a href="${args.link}" style="display: inline-block; background: #c2410c; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
      Open Canon to decide →
    </a>
  </p>
  <p style="font-size: 11px; color: #9ca3af; margin: 16px 0 0;">
    Your decision is signed (Ed25519) and joins the same hash-chained ledger every Canon agent reads from.
    Link expires in 24 hours.
  </p>
</body>
</html>`;
}

function renderEscalationText(args: SendEscalationNotificationArgs & { link: string }): string {
  const reason =
    args.kind === 'ask_skipped_no_authors'
      ? `All sources are automated; Canon routed this directly to ${args.role}.`
      : `Source-authors couldn't agree; Canon escalated to ${args.role}.`;
  return [
    `Canon escalated ${args.entity}.${args.metricKey} to ${args.role} (${args.authorityEmail}).`,
    '',
    reason,
    '',
    'Competing claims:',
    ...args.candidateLines.map((c) => `  - ${c}`),
    '',
    `Open Canon to decide:  ${args.link}`,
    '',
    'Your decision is signed and joins the same hash-chained ledger every Canon agent reads from. Link expires in 24h.',
  ].join('\n');
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
  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 11px; font-family: ui-monospace, monospace; color: #2563eb; text-transform: uppercase; letter-spacing: 0.08em;">
      Asked of
    </p>
    <p style="margin: 2px 0 0; font-size: 15px; font-weight: 600; color: #1e3a8a;">
      ${escapeHtml(name)} <span style="font-weight: 400; color: #475569;">&lt;${escapeHtml(args.personaEmail)}&gt;</span>
    </p>
  </div>
  <h2 style="font-size: 18px; margin: 0 0 12px;">Canon needs your input</h2>
  <p style="font-size: 14px; margin: 0 0 16px;">
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
