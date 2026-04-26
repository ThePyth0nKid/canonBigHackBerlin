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
import { sendAskEmails } from '@/lib/canon/decide-mail';

async function requireUser(): Promise<{ userId: string; email: string } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const userId = (session.user as { id?: string }).id;
  const email = (session.user as { email?: string | null }).email ?? null;
  if (!userId || !email) return null;
  return { userId, email };
}

export async function askSourceAuthorsAction(input: {
  entity: string;
  metricKey: string;
  conflictFactIds: string[];
}) {
  const me = await requireUser();
  if (!me) return { ok: false as const, reason: 'auth' };

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
   * Logical addressee identity to attribute this response to. In V1 the
   * signed-in workspace owner is implicitly authorized to respond on behalf
   * of any addressee — the audit trail still records who logically answered.
   * Real per-addressee auth is V2.
   */
  respondingAs: string;
}) {
  const me = await requireUser();
  if (!me) return { ok: false as const, reason: 'auth' };
  return respondCore({
    userId: me.userId,
    responderEmail: input.respondingAs,
    threadId: input.threadId,
    choice: input.choice,
    chosenFactId: input.chosenFactId,
  });
}

export async function escalateAction(input: { threadId: string }) {
  const me = await requireUser();
  if (!me) return { ok: false as const, reason: 'auth' };
  return escalateCore({ userId: me.userId, threadId: input.threadId });
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
  const me = await requireUser();
  if (!me) return { ok: false as const, reason: 'auth' };
  return escalateDirectCore({
    userId: me.userId,
    entity: input.entity,
    metricKey: input.metricKey,
    conflictFactIds: input.conflictFactIds,
  });
}

export async function resolveByAuthorityAction(input: {
  threadId: string;
  winnerFactId: string;
}) {
  const me = await requireUser();
  if (!me) return { ok: false as const, reason: 'auth' };
  return resolveCore({
    userId: me.userId,
    authorityEmail: me.email,
    threadId: input.threadId,
    winnerFactId: input.winnerFactId,
  });
}
