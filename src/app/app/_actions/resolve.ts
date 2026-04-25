'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { CanonSigner } from '@/lib/canon/sign';

/**
 * User-pick conflict resolution.
 *
 * Persists a *signed* ResolutionEvent (status='resolution') anchored to the
 * tip of the user's hash chain — this makes the user's choice itself
 * cryptographically tamper-proof, not just a database flag. Then flips every
 * other competing active fact to 'superseded' with a notes pointer back to
 * the resolution's eventHash for traceability.
 */
export async function resolveConflict(args: {
  entity: string;
  metricKey: string;
  winnerFactId: string;
}): Promise<{ ok: boolean; superseded: number; resolutionFactId?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, superseded: 0 };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { ok: false, superseded: 0 };

  const winner = await prisma.factEvent.findFirst({
    where: { id: args.winnerFactId, userId },
    select: {
      id: true,
      entity: true,
      metricKey: true,
      metricValue: true,
      metricUnit: true,
    },
  });
  if (!winner) return { ok: false, superseded: 0 };

  const losers = await prisma.factEvent.findMany({
    where: {
      userId,
      entity: args.entity,
      metricKey: args.metricKey,
      status: 'active',
      NOT: { id: args.winnerFactId },
    },
    select: { id: true, metricValue: true },
  });

  // Tip of the chain — the new resolution event chains off it.
  const tail = await prisma.factEvent.findFirst({
    where: { userId },
    orderBy: { signedAt: 'desc' },
    select: { eventHash: true },
  });
  const parentHash = tail?.eventHash ?? '';

  const signer = new CanonSigner();
  signer.start();
  const resolutionFactId = `f_res_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const claim = `Resolution: ${args.entity}.${args.metricKey} = ${winner.metricValue ?? '(no value)'} (user pick over ${losers.length} alternative${losers.length === 1 ? '' : 's'}).`;
  const sourceRef = `resolution:user:${userId}`;

  let signRes;
  try {
    signRes = await signer.sign({
      factId: resolutionFactId,
      entity: args.entity,
      claim,
      sourceRef,
      sourceExcerpt: claim,
      parentHash,
      createdAtMs: Date.now(),
    });
  } finally {
    await signer.close();
  }

  await prisma.$transaction([
    prisma.factEvent.create({
      data: {
        id: resolutionFactId,
        userId,
        entity: args.entity,
        claim,
        metricKey: args.metricKey,
        metricValue: winner.metricValue ?? null,
        metricUnit: winner.metricUnit ?? null,
        sourceRef,
        sourceExcerpt: claim,
        parentHash: parentHash || null,
        eventHash: signRes.eventHash,
        coseSign1Hex: signRes.coseSign1Hex,
        signerPubkey: signRes.signerPubkey,
        signedAt: new Date(signRes.signedAtMs),
        observedAt: new Date(),
        status: 'resolution',
        notes: `resolution:winner=${args.winnerFactId}:losers=${losers.map((l) => l.id).join(',')}`,
      },
    }),
    prisma.factEvent.updateMany({
      where: { id: { in: losers.map((l) => l.id) } },
      data: {
        status: 'superseded',
        notes: `superseded:user-pick:${signRes.eventHash}`,
      },
    }),
  ]);

  revalidatePath('/app');
  return {
    ok: true,
    superseded: losers.length,
    resolutionFactId,
  };
}
