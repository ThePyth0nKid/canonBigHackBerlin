'use server';

import { auth } from '@/auth';
import {
  askSourceAuthors as askCore,
  recordResponse as respondCore,
  escalateToAuthority as escalateCore,
  resolveByAuthority as resolveCore,
  type ResponseChoice,
} from '@/lib/canon/decide';

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
  return askCore({
    userId: me.userId,
    entity: input.entity,
    metricKey: input.metricKey,
    conflictFactIds: input.conflictFactIds,
  });
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
