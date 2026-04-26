'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import {
  askSourceAuthors as askCore,
  recordResponse as respondCore,
  escalateToAuthority as escalateCore,
  escalateDirectly as escalateDirectCore,
  resolveByAuthority as resolveCore,
  type ResponseChoice,
} from '@/lib/canon/decide';
import { sendAskEmails, sendEscalationNotification } from '@/lib/canon/decide-mail';
import {
  readPersonaContext,
  clearPersonaCookie,
  type PersonaContext,
} from '@/lib/canon/persona-cookie';
import { emailForRole, routeMetricToRole } from '@/lib/canon/escalation-policy';

interface AuthedUser {
  userId: string;
  email: string;
}

async function requireUser(): Promise<AuthedUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  const userId = (session.user as { id?: string }).id;
  const email = (session.user as { email?: string | null }).email ?? null;
  if (!userId || !email) return null;
  return { userId, email };
}

/**
 * RBAC gate: admin actions (ask, escalate, resolve, decide-direct) are
 * permitted ONLY when no persona cookie is present. A persona cookie means
 * the request is acting under a magic-link recipient's scope; admin
 * surface is forbidden in that mode regardless of session identity.
 */
async function requireAdmin(): Promise<
  | { ok: true; user: AuthedUser }
  | { ok: false; reason: 'auth' | 'forbidden_persona_cannot_admin' }
> {
  const me = await requireUser();
  if (!me) return { ok: false, reason: 'auth' };
  const persona = await readPersonaContext();
  if (persona) return { ok: false, reason: 'forbidden_persona_cannot_admin' };
  return { ok: true, user: me };
}

/**
 * RBAC gate: persona-scoped actions (recordResponse) require a valid
 * persona cookie matching the threadId being acted on AND the persona
 * email being responded as. Both checks server-side — clients can't
 * forge a persona without the MAGIC_LINK_SECRET.
 */
async function requirePersona(args: {
  threadId: string;
  respondingAs: string;
}): Promise<
  | { ok: true; user: AuthedUser; persona: PersonaContext }
  | {
      ok: false;
      reason: 'auth' | 'forbidden_no_persona' | 'forbidden_thread_mismatch' | 'forbidden_persona_mismatch';
    }
> {
  const me = await requireUser();
  if (!me) return { ok: false, reason: 'auth' };
  const persona = await readPersonaContext();
  if (!persona) return { ok: false, reason: 'forbidden_no_persona' };
  if (persona.threadId !== args.threadId) {
    return { ok: false, reason: 'forbidden_thread_mismatch' };
  }
  if (persona.as.toLowerCase() !== args.respondingAs.toLowerCase()) {
    return { ok: false, reason: 'forbidden_persona_mismatch' };
  }
  return { ok: true, user: me, persona };
}

export async function askSourceAuthorsAction(input: {
  entity: string;
  metricKey: string;
  conflictFactIds: string[];
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false as const, reason: gate.reason };
  const me = gate.user;

  const result = await askCore({
    userId: me.userId,
    entity: input.entity,
    metricKey: input.metricKey,
    conflictFactIds: input.conflictFactIds,
  });

  // Email dispatch is fire-and-forget AFTER the FactEvent is committed —
  // a Resend outage must never roll back the signed ask. The mail
  // outcome is recorded as a separate audit annotation. Slack-author
  // addressees are skipped (Slack DM is V3 — no token plumbing yet).
  if (result.ok && result.threadId && result.addressees && result.addressees.length > 0) {
    const gmailRecipients = result.addressees.filter((a) => a.kind === 'gmail');
    if (gmailRecipients.length > 0) {
      await dispatchAskEmails({
        userId: me.userId,
        threadId: result.threadId,
        entity: input.entity,
        metricKey: input.metricKey,
        conflictFactIds: input.conflictFactIds,
        recipients: gmailRecipients.map((a) => ({ personaEmail: a.id })),
      });
    }
  }

  return result;
}

async function dispatchAskEmails(args: {
  userId: string;
  threadId: string;
  entity: string;
  metricKey: string;
  conflictFactIds: string[];
  recipients: { personaEmail: string }[];
}): Promise<void> {
  // Resolve persona display names from User table for friendlier email greetings.
  const users = await prisma.user.findMany({
    where: { email: { in: args.recipients.map((r) => r.personaEmail) } },
    select: { email: true, name: true },
  });
  const nameByEmail = new Map(users.map((u) => [u.email?.toLowerCase() ?? '', u.name]));

  // Fetch the candidate facts so the email body has concrete competing values.
  const facts = await prisma.factEvent.findMany({
    where: { id: { in: args.conflictFactIds }, userId: args.userId },
    select: { metricValue: true, sourceRef: true },
  });
  const candidateLines = facts.map((f) => {
    const kind = f.sourceRef.split(':')[0] ?? 'source';
    return `${f.metricValue ?? '(no value)'} via ${kind}`;
  });

  const baseUrl = process.env.AUTH_URL ?? 'https://canon.ultranova.io';
  const recipientsWithNames = args.recipients.map((r) => ({
    personaEmail: r.personaEmail,
    personaName: nameByEmail.get(r.personaEmail.toLowerCase()) ?? undefined,
  }));

  let outcome;
  try {
    outcome = await sendAskEmails({
      threadId: args.threadId,
      entity: args.entity,
      metricKey: args.metricKey,
      candidateLines,
      recipients: recipientsWithNames,
      baseUrl,
    });
  } catch (e) {
    outcome = {
      attempted: args.recipients.length,
      sent: 0,
      failed: args.recipients.map((r) => ({
        personaEmail: r.personaEmail,
        error: (e as Error).message,
      })),
    };
  }

  // Audit annotation: write a tiny note onto the ask FactEvent's notes
  // field summarising the dispatch outcome. We use prisma.update on the
  // ask event identified by sourceRef='decide:ask:<threadId>'.
  try {
    const ask = await prisma.factEvent.findFirst({
      where: { userId: args.userId, sourceRef: `decide:ask:${args.threadId}` },
      select: { id: true, notes: true },
    });
    if (ask) {
      const suffix = `:mail=sent=${outcome.sent}/${outcome.attempted}${outcome.failed.length > 0 ? `:mail-fail=${outcome.failed.map((f) => f.personaEmail).join(',')}` : ''}`;
      await prisma.factEvent.update({
        where: { id: ask.id },
        data: { notes: `${ask.notes ?? ''}${suffix}` },
      });
    }
  } catch (e) {
    console.error('[decide-mail] audit annotation failed:', (e as Error).message);
  }
}

export async function recordResponseAction(input: {
  threadId: string;
  choice: ResponseChoice;
  chosenFactId?: string;
  /**
   * Logical addressee identity. Server-side this MUST match the persona
   * cookie's `as` field — the cookie is the only way to prove the caller
   * holds a valid magic-link for this thread.
   */
  respondingAs: string;
}) {
  const gate = await requirePersona({
    threadId: input.threadId,
    respondingAs: input.respondingAs,
  });
  if (!gate.ok) return { ok: false as const, reason: gate.reason };
  const me = gate.user;
  return respondCore({
    userId: me.userId,
    responderEmail: input.respondingAs,
    threadId: input.threadId,
    choice: input.choice,
    chosenFactId: input.chosenFactId,
  });
}

export async function escalateAction(input: { threadId: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false as const, reason: gate.reason };
  const me = gate.user;
  const result = await escalateCore({ userId: me.userId, threadId: input.threadId });
  // Notification email so the demo flow shows a fresh email for every
  // escalation click. The role's authority is the recipient identity in
  // the magic-link token.
  if (result.ok && result.role && result.authorityEmail) {
    await dispatchEscalationNotification({
      userId: me.userId,
      threadId: input.threadId,
      role: result.role,
      authorityEmail: result.authorityEmail,
      kind: 'escalation_after_divergence',
    });
  }
  return result;
}

/**
 * Direct escalation for conflicts whose sources are all automated (no human
 * author to ask). Skips Stage 1 and routes straight to the policy authority,
 * still anchored on a synthetic ask-skipped event so the chain walks cleanly.
 */
export async function escalateDirectlyAction(input: {
  entity: string;
  metricKey: string;
  conflictFactIds: string[];
}) {
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false as const, reason: gate.reason };
  const me = gate.user;
  const result = await escalateDirectCore({
    userId: me.userId,
    entity: input.entity,
    metricKey: input.metricKey,
    conflictFactIds: input.conflictFactIds,
  });
  // Even when no human authors are reachable, fire a notification email
  // to the workspace owner so the on-stage demo always sees an email
  // arrive within seconds of every click. This is honest about the
  // routing (the email subject says "Canon escalated to <role>") and
  // gives the audience a continuous email beat across all card types.
  if (result.ok && result.threadId && result.role && result.authorityEmail) {
    await dispatchEscalationNotification({
      userId: me.userId,
      threadId: result.threadId,
      role: result.role,
      authorityEmail: result.authorityEmail,
      kind: 'ask_skipped_no_authors',
    });
  }
  return result;
}

async function dispatchEscalationNotification(args: {
  userId: string;
  threadId: string;
  role: string;
  authorityEmail: string;
  kind: 'ask_skipped_no_authors' | 'escalation_after_divergence';
}): Promise<void> {
  // Resolve entity, metricKey, and competing facts via the thread's ask event.
  const ask = await prisma.factEvent.findFirst({
    where: { userId: args.userId, sourceRef: `decide:ask:${args.threadId}` },
    select: { entity: true, metricKey: true, notes: true },
  });
  if (!ask?.entity || !ask?.metricKey) return;

  const conflictMatch = ask.notes?.match(/(?:^|:)conflictFacts=([^:]+)/);
  const conflictFactIds = conflictMatch?.[1].split(',').filter(Boolean) ?? [];
  const facts = await prisma.factEvent.findMany({
    where: { id: { in: conflictFactIds }, userId: args.userId },
    select: { metricValue: true, sourceRef: true },
  });
  const candidateLines = facts.map((f) => {
    const kind = f.sourceRef.split(':')[0] ?? 'source';
    return `${f.metricValue ?? '(no value)'} via ${kind}`;
  });

  const baseUrl = process.env.AUTH_URL ?? 'https://canon.ultranova.io';
  try {
    const outcome = await sendEscalationNotification({
      threadId: args.threadId,
      entity: ask.entity,
      metricKey: ask.metricKey,
      candidateLines,
      role: args.role,
      authorityEmail: args.authorityEmail,
      kind: args.kind,
      baseUrl,
    });
    console.log(
      `[decide-mail] escalation notification ${outcome.sent ? 'sent' : 'failed'} for thread=${args.threadId}${outcome.error ? ': ' + outcome.error : ''}`,
    );
  } catch (e) {
    console.error(
      '[decide-mail] escalation notification threw:',
      (e as Error).message,
    );
  }
}

export async function resolveByAuthorityAction(input: {
  threadId: string;
  winnerFactId: string;
}) {
  // Authority pick is admin-only. Workspace owner can sign as any role
  // (V1 owner-trust); a routed authority would in V2 also be allowed
  // when session.email matches the role's authority email.
  const gate = await requireAdmin();
  if (!gate.ok) return { ok: false as const, reason: gate.reason };
  const me = gate.user;
  return resolveCore({
    userId: me.userId,
    authorityEmail: me.email,
    threadId: input.threadId,
    winnerFactId: input.winnerFactId,
  });
}

/**
 * Clears the persona cookie. Called from the "Exit persona" link in the
 * /decide UI when the workspace owner wants to return to admin scope
 * without waiting for the 30-min cookie TTL.
 */
export async function exitPersonaAction(): Promise<{ ok: true }> {
  await clearPersonaCookie();
  return { ok: true };
}

// Avoid unused-import warnings — these helpers are imported for symmetry
// with the V1 owner-trust comments and used by future authority gating.
void emailForRole;
void routeMetricToRole;
