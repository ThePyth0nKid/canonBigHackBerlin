'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { CanonSigner } from '@/lib/canon/sign';
import { requireAdmin } from '@/lib/canon/admin';

/**
 * Admin reverse of a signed resolution.
 *
 * The original ResolutionEvent stays in the chain — nothing is ever
 * deleted. We sign a NEW event at the current chain tip
 * (status='resolution-reversed') that points at the original eventHash
 * and carries a human reason. The originally-superseded losers flip
 * back to 'active' so they re-appear in search/aggregation; the
 * original resolution row's status flips to 'resolution-reversed' with
 * a notes pointer to the reverse event so the audit trail reads
 * forwards and backwards.
 *
 * For 'distinct' resolutions the same path applies — the candidates'
 * `distinct:reviewed:<hash>` notes are cleared.
 */
export async function reverseResolution(args: {
  resolutionFactId: string;
  reason: string;
}): Promise<
  | { ok: true; reactivated: number; reverseEventHash: string }
  | { ok: false; error: string }
> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: 'admin-required' };

  const reason = (args.reason ?? '').trim().slice(0, 500);
  if (reason.length < 3) {
    return { ok: false, error: 'reason-required' };
  }

  // Workspace-scoped, NOT userId-scoped — any admin can reverse any
  // admin's resolution. The cosign action already drops userId filtering
  // for the same reason (different OAuth identity must be able to act on
  // initiator's row); reverseResolution must follow the same rule or
  // a 4-eyes resolution becomes uncorrectable by the non-initiator admin.
  const original = await prisma.factEvent.findFirst({
    where: { id: args.resolutionFactId },
    select: {
      id: true,
      workspace: true,
      entity: true,
      metricKey: true,
      status: true,
      notes: true,
      eventHash: true,
    },
  });
  if (!original) return { ok: false, error: 'resolution-not-found' };
  if (original.status !== 'resolution') {
    return { ok: false, error: `cannot-reverse:status=${original.status}` };
  }

  const parsed = parseResolutionNotes(original.notes ?? '');
  if (!parsed) return { ok: false, error: 'unparseable-notes' };

  // Chain-tip lookup is workspace-scoped, not user-scoped — the chain
  // is a single forwards-linked sequence per workspace; signing under a
  // user-scoped tip would fork the chain whenever a different admin acts.
  const tail = await prisma.factEvent.findFirst({
    where: { workspace: original.workspace },
    orderBy: { signedAt: 'desc' },
    select: { eventHash: true },
  });
  const parentHash = tail?.eventHash ?? '';

  const reverseFactId = `f_rev_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const claim =
    parsed.kind === 'canonical'
      ? `Reverse-resolution: ${original.entity}.${original.metricKey ?? '?'} — admin reactivated ${parsed.loserIds.length} previously-superseded fact${parsed.loserIds.length === 1 ? '' : 's'}. Reason: ${reason}`
      : `Reverse-resolution (distinct): ${original.entity}.${original.metricKey ?? '?'} — admin cleared distinct-acknowledgement on ${parsed.candidateIds.length} fact${parsed.candidateIds.length === 1 ? '' : 's'}. Reason: ${reason}`;
  const sourceRef = `resolution:reverse:${admin.userId}`;

  const signer = new CanonSigner();
  signer.start();
  let signRes;
  try {
    signRes = await signer.sign({
      factId: reverseFactId,
      entity: original.entity,
      claim,
      sourceRef,
      sourceExcerpt: claim,
      parentHash,
      createdAtMs: Date.now(),
    });
  } finally {
    await signer.close();
  }

  const reverseRow = prisma.factEvent.create({
    data: {
      id: reverseFactId,
      userId: admin.userId,
      workspace: original.workspace,
      entity: original.entity,
      claim,
      metricKey: original.metricKey ?? null,
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
      status: 'resolution-reversed',
      notes: `reverse-of:${original.eventHash}:reason:${reason.replace(/\n/g, ' ')}`,
    },
  });

  const markOriginal = prisma.factEvent.update({
    where: { id: original.id },
    data: {
      status: 'resolution-reversed',
      notes: `${original.notes ?? ''};reversed-by:${signRes.eventHash}:by:${admin.email || admin.userId}`,
    },
  });

  let reactivated = 0;
  if (parsed.kind === 'canonical' && parsed.loserIds.length > 0) {
    const r = await prisma.$transaction([
      reverseRow,
      markOriginal,
      prisma.factEvent.updateMany({
        where: {
          id: { in: parsed.loserIds },
          // Loser id list is signed-event-derived and authoritative;
          // workspace-scoped to prevent cross-workspace impact only.
          workspace: original.workspace,
          status: 'superseded',
        },
        data: { status: 'active', notes: null },
      }),
    ]);
    reactivated = r[2].count;
  } else if (parsed.kind === 'distinct' && parsed.candidateIds.length > 0) {
    const r = await prisma.$transaction([
      reverseRow,
      markOriginal,
      prisma.factEvent.updateMany({
        where: {
          id: { in: parsed.candidateIds },
          // Loser id list is signed-event-derived and authoritative;
          // workspace-scoped to prevent cross-workspace impact only.
          workspace: original.workspace,
        },
        data: { notes: null },
      }),
    ]);
    reactivated = r[2].count;
  } else {
    await prisma.$transaction([reverseRow, markOriginal]);
  }

  revalidatePath('/app');
  revalidatePath('/decide');
  return { ok: true, reactivated, reverseEventHash: signRes.eventHash };
}

type ParsedNotes =
  | { kind: 'canonical'; winnerId: string; loserIds: string[] }
  | { kind: 'distinct'; candidateIds: string[] };

/**
 * Original write shapes (resolve.ts):
 *   canonical: "resolution:winner=<id>:losers=<id1,id2,...>"
 *   distinct:  "resolution:distinct:candidates=<id1,id2,...>"
 */
function parseResolutionNotes(notes: string): ParsedNotes | null {
  if (!notes) return null;
  const winnerMatch = /winner=([^:]+):losers=([^;]*)/.exec(notes);
  if (winnerMatch) {
    const loserIds = winnerMatch[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { kind: 'canonical', winnerId: winnerMatch[1], loserIds };
  }
  const distinctMatch = /distinct:candidates=([^;]*)/.exec(notes);
  if (distinctMatch) {
    const candidateIds = distinctMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { kind: 'distinct', candidateIds };
  }
  return null;
}
