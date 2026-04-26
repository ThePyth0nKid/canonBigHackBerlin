import { prisma } from '@/lib/prisma';
import type { RiskTier } from './risk-tier';

/**
 * Reads `status='resolution-pending'` rows from the chain — the high-risk
 * picks that have been signed as proposals but are awaiting a second
 * admin's co-signature before supersedure applies.
 *
 * Workspace-scoped, NOT userId-scoped. The pending row carries the
 * initiator's userId, but a different admin (different OAuth identity =
 * different userId, same workspace) needs to see + co-sign it. The
 * admin gate (CANON_ADMIN_EMAILS) replaces the userId filter — without
 * that gate this function MUST stay server-side.
 */
export interface PendingResolution {
  /** factId of the resolution-pending row. */
  resolutionFactId: string;
  /** Hash of the signed pending event — used as anchor for the cosign event. */
  eventHash: string;
  workspace: string;
  entity: string;
  /** "Inazuma Brewing Co." style. Falls back to entity slug if absent. */
  entityDisplay: string;
  metricKey: string;
  /** Proposed canonical value (winner.metricValue). */
  metricValue: string | null;
  metricUnit: string | null;
  tier: RiskTier;
  initiatorEmail: string;
  initiatorUserId: string;
  signedAt: Date;
  /** factId of the candidate the initiator picked. */
  winnerFactId: string;
  /** factIds that will flip to 'superseded' once co-signed. */
  loserIds: string[];
  /** Quick-render counter; equal to loserIds.length. */
  willSupersedeCount: number;
}

/**
 * Server query — admin-only callers. The function itself does NOT
 * enforce admin (server-action / page-component callers must), so it
 * can be reused in trusted contexts (background sweeps, audits).
 */
export async function loadPendingResolutions(
  workspace: string,
): Promise<PendingResolution[]> {
  const rows = await prisma.factEvent.findMany({
    where: { workspace, status: 'resolution-pending' },
    orderBy: { signedAt: 'desc' },
    select: {
      id: true,
      eventHash: true,
      workspace: true,
      entity: true,
      metricKey: true,
      metricValue: true,
      metricUnit: true,
      signedAt: true,
      userId: true,
      notes: true,
    },
  });

  const entitySlugs = [...new Set(rows.map((r) => r.entity))];
  const displayMap = await loadEntityDisplays(entitySlugs);

  const out: PendingResolution[] = [];
  for (const r of rows) {
    const parsed = parsePendingNotes(r.notes ?? '');
    if (!parsed) continue;
    out.push({
      resolutionFactId: r.id,
      eventHash: r.eventHash,
      workspace: r.workspace,
      entity: r.entity,
      entityDisplay: displayMap.get(r.entity) ?? humanise(r.entity),
      metricKey: r.metricKey ?? '?',
      metricValue: r.metricValue,
      metricUnit: r.metricUnit,
      tier: parsed.tier,
      initiatorEmail: parsed.initiator,
      initiatorUserId: r.userId,
      signedAt: r.signedAt,
      winnerFactId: parsed.winnerId,
      loserIds: parsed.loserIds,
      willSupersedeCount: parsed.loserIds.length,
    });
  }
  return out;
}

/**
 * Notes shape (set in resolve.ts runCanonicalResolution fourEyes branch):
 *   pending:awaiting-cosign:tier=high:initiator=<email>:winner=<id>:losers=<id1,id2,...>
 */
function parsePendingNotes(notes: string): {
  tier: RiskTier;
  initiator: string;
  winnerId: string;
  loserIds: string[];
} | null {
  const tierMatch = /tier=([a-z]+)/.exec(notes);
  const initMatch = /initiator=([^:]+):/.exec(notes);
  const winnerMatch = /winner=([^:]+):losers=([^;]*)/.exec(notes);
  if (!tierMatch || !initMatch || !winnerMatch) return null;
  const tier = (['low', 'medium', 'high'] as const).find((t) => t === tierMatch[1]);
  if (!tier) return null;
  const loserIds = winnerMatch[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    tier,
    initiator: initMatch[1],
    winnerId: winnerMatch[1],
    loserIds,
  };
}

async function loadEntityDisplays(slugs: string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = await prisma.factEvent.findMany({
    where: { entity: { in: slugs }, metricKey: 'display_name', status: 'active' },
    select: { entity: true, metricValue: true },
    distinct: ['entity'],
  });
  return new Map(rows.map((r) => [r.entity, r.metricValue ?? humanise(r.entity)]));
}

function humanise(slug: string): string {
  return slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Cheap set of `${entity}::${metricKey}` pairs that currently have a
 * resolution-pending row in the given workspace. Used by conflict
 * aggregators to suppress already-proposed pairs — without this, a
 * high-risk pick that wrote a pending row would still resurface as
 * an open conflict in AskCanon, prompting the initiator to pick
 * again and produce a duplicate pending row.
 *
 * Workspace-scoped only; admin-gating happens upstream in the page
 * components that surface the pending panel.
 */
export async function loadPendingPairKeys(workspace: string): Promise<Set<string>> {
  const rows = await prisma.factEvent.findMany({
    where: { workspace, status: 'resolution-pending' },
    select: { entity: true, metricKey: true },
  });
  return new Set(rows.map((r) => `${r.entity}::${r.metricKey ?? ''}`));
}
