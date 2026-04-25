'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { CanonSigner } from '@/lib/canon/sign';

/**
 * User-pick conflict resolution.
 *
 * Two outcomes a human can reach when staring at competing claims:
 *   1. **canonical** — pick one as the source of truth. Emit a signed
 *      ResolutionEvent at the chain tip; flip the rest to 'superseded'
 *      with a notes pointer back to the resolution's eventHash.
 *   2. **distinct** — the records aren't competing claims at all,
 *      they're SEPARATE records that happen to share an entity slug
 *      (same business name, different client_ids; same metric, different
 *      time-windows; etc.). Emit a signed acknowledgement event tagged
 *      `status='distinct'` — none of the original facts get superseded;
 *      they all stay active. The audit chain records that a human
 *      reviewed them and decided they were distinct.
 *
 * Both outcomes are signed events. Canon doesn't auto-merge identity —
 * it surfaces provenance and records the human's call.
 */
export async function resolveConflict(args:
  | {
      mode: 'canonical';
      entity: string;
      metricKey: string;
      winnerFactId: string;
    }
  | {
      mode: 'distinct';
      entity: string;
      metricKey: string;
      candidateFactIds: string[];
    },
): Promise<{ ok: boolean; superseded: number; resolutionFactId?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, superseded: 0 };
  const userId = (session.user as { id?: string }).id;
  if (!userId) return { ok: false, superseded: 0 };

  if (args.mode === 'canonical') {
    return runCanonicalResolution({ ...args, userId });
  }
  return runDistinctRecords({ ...args, userId });
}

async function runCanonicalResolution(args: {
  userId: string;
  entity: string;
  metricKey: string;
  winnerFactId: string;
}): Promise<{ ok: boolean; superseded: number; resolutionFactId?: string }> {
  const { userId } = args;
  // Lookup the winner first — its workspace becomes the scope for everything
  // that follows. Without this scoping, picking ACME.seats=50 in Northwind
  // could accidentally supersede an unrelated huang_llc.industry fact in
  // Inazuma if the entity slugs ever collided.
  const winner = await prisma.factEvent.findFirst({
    where: { id: args.winnerFactId, userId },
    select: {
      id: true,
      entity: true,
      metricKey: true,
      metricValue: true,
      metricUnit: true,
      workspace: true,
    },
  });
  if (!winner) return { ok: false, superseded: 0 };

  const workspace = winner.workspace;

  const losers = await prisma.factEvent.findMany({
    where: {
      userId,
      workspace,
      entity: args.entity,
      metricKey: args.metricKey,
      status: 'active',
      NOT: { id: args.winnerFactId },
    },
    select: { id: true, metricValue: true },
  });

  const tail = await prisma.factEvent.findFirst({
    where: { userId, workspace },
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
        workspace,
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
  return { ok: true, superseded: losers.length, resolutionFactId };
}

async function runDistinctRecords(args: {
  userId: string;
  entity: string;
  metricKey: string;
  candidateFactIds: string[];
}): Promise<{ ok: boolean; superseded: number; resolutionFactId?: string }> {
  const { userId } = args;
  if (!args.candidateFactIds || args.candidateFactIds.length < 2) {
    return { ok: false, superseded: 0 };
  }

  // Workspace from the first candidate (all should be in the same workspace
  // since the conflict modal scopes by workspace already).
  const seed = await prisma.factEvent.findFirst({
    where: { id: args.candidateFactIds[0], userId },
    select: { workspace: true, metricUnit: true },
  });
  if (!seed) return { ok: false, superseded: 0 };
  const workspace = seed.workspace;

  const tail = await prisma.factEvent.findFirst({
    where: { userId, workspace },
    orderBy: { signedAt: 'desc' },
    select: { eventHash: true },
  });
  const parentHash = tail?.eventHash ?? '';

  const signer = new CanonSigner();
  signer.start();
  const resolutionFactId = `f_dist_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const claim = `Records reviewed and confirmed DISTINCT: ${args.entity}.${args.metricKey} (${args.candidateFactIds.length} independent records — none supersedes another). Same entity slug, different source records.`;
  const sourceRef = `resolution:distinct:${userId}`;

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

  // Note on each candidate: distinct-records pointer. Don't supersede.
  await prisma.$transaction([
    prisma.factEvent.create({
      data: {
        id: resolutionFactId,
        userId,
        workspace,
        entity: args.entity,
        claim,
        metricKey: args.metricKey,
        metricValue: null,
        metricUnit: null,
        sourceRef,
        sourceExcerpt: claim,
        parentHash: parentHash || null,
        eventHash: signRes.eventHash,
        coseSign1Hex: signRes.coseSign1Hex,
        signerPubkey: signRes.signerPubkey,
        signedAt: new Date(signRes.signedAtMs),
        observedAt: new Date(),
        status: 'resolution',
        notes: `resolution:distinct:candidates=${args.candidateFactIds.join(',')}`,
      },
    }),
    prisma.factEvent.updateMany({
      where: { id: { in: args.candidateFactIds } },
      data: { notes: `distinct:reviewed:${signRes.eventHash}` },
    }),
  ]);

  revalidatePath('/app');
  return { ok: true, superseded: 0, resolutionFactId };
}
