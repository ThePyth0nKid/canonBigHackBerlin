'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import {
  summarizeConflict,
  type ConflictSummary,
} from '@/lib/canon/conflict-summary';
import type { FactRow } from '@/lib/canon/view';

export interface SummarizeArgs {
  entity: string;
  metricKey: string;
  factIds: string[];
}

export async function summarizeConflictAction(
  args: SummarizeArgs,
): Promise<ConflictSummary | { error: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: 'unauthorized' };
  if (!args.factIds || args.factIds.length < 2) {
    return { error: 'need at least 2 factIds' };
  }

  // Re-fetch the facts server-side (don't trust the client to pass full
  // bodies). We constrain by userId so a malicious request can't summarise
  // someone else's ledger.
  const rows = await prisma.factEvent.findMany({
    where: { userId, id: { in: args.factIds } },
    select: {
      id: true, entity: true, claim: true, sourceRef: true,
      sourceExcerpt: true, metricKey: true, metricValue: true,
      metricUnit: true, signedAt: true, observedAt: true,
      eventHash: true, signerPubkey: true, parentHash: true,
      coseSign1Hex: true, status: true, notes: true,
    },
  });
  if (rows.length < 2) return { error: 'not enough facts found' };

  const facts: FactRow[] = rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    claim: r.claim,
    metricKey: r.metricKey,
    metricValue: r.metricValue,
    metricUnit: r.metricUnit,
    sourceRef: r.sourceRef,
    sourceExcerpt: r.sourceExcerpt,
    status: (r.status as FactRow['status']) ?? 'active',
    notes: r.notes,
    parentHash: r.parentHash,
    eventHash: r.eventHash,
    signerPubkey: r.signerPubkey,
    coseSign1Hex: r.coseSign1Hex,
    signedAt: r.signedAt,
    observedAt: r.observedAt,
  }));

  try {
    return await summarizeConflict({
      entity: args.entity,
      metricKey: args.metricKey,
      facts,
    });
  } catch (e) {
    console.error('[summarizeConflictAction] gemini error', e);
    return { error: `Gemini call failed: ${(e as Error).message}` };
  }
}
