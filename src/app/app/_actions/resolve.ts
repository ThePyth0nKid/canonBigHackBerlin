'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

/**
 * User-pick conflict resolution: flag every active fact for (entity, metricKey)
 * other than `winnerFactId` as superseded, with a `notes` pointer to the pick.
 *
 * The pick itself stays `active`. The chain is preserved — we don't re-sign
 * here; the audit story is "user picked f_xxx; the others reference it".
 */
export async function resolveConflict(args: {
  entity: string;
  metricKey: string;
  winnerFactId: string;
}): Promise<{ ok: boolean; superseded: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, superseded: 0 };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { ok: false, superseded: 0 };

  const winner = await prisma.factEvent.findFirst({
    where: { id: args.winnerFactId, userId },
    select: { id: true, entity: true, metricKey: true },
  });
  if (!winner) return { ok: false, superseded: 0 };

  const result = await prisma.factEvent.updateMany({
    where: {
      userId,
      entity: args.entity,
      metricKey: args.metricKey,
      status: 'active',
      NOT: { id: args.winnerFactId },
    },
    data: {
      status: 'superseded',
      notes: `superseded:user-pick:${args.winnerFactId}`,
    },
  });

  revalidatePath('/app');
  return { ok: true, superseded: result.count };
}
