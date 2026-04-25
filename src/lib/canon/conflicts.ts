/**
 * Post-sign conflict detection and recency-based auto-resolution.
 *
 * Groups every active FactEvent by (entity, metricKey). When 2+ different
 * metricValues compete:
 *   - all values agree  → corroboration (no DB writes; query-time concept)
 *   - values disagree   → keep the most recently OBSERVED one as `active`,
 *                         flip the rest to `superseded` with a `notes`
 *                         pointer to the winning factId.
 *
 * User-pick resolution (the UI version in Block C) supersedes this auto-pick;
 * for the demo it's the offline default so /app shows clean state on first load.
 */

import { prisma } from '@/lib/prisma';

export interface ConflictGroup {
  entity: string;
  metricKey: string;
  /** Distinct normalized values present in this group. */
  values: ConflictValue[];
  totalFacts: number;
}

export interface ConflictValue {
  /** Normalized value used as the equality key. */
  valueKey: string;
  /** Display value (the original verbatim metric_value). */
  displayValue: string;
  factIds: string[];
  sources: string[]; // unique sourceRef prefixes
  /** Most recent observedAt across the matching facts. */
  latestObservedAt: Date | null;
}

export interface ConflictResolution {
  entity: string;
  metricKey: string;
  winnerFactId: string;
  winnerValue: string;
  supersededFactIds: string[];
  reason: 'recency' | 'corroboration';
}

/**
 * Run a fresh sweep against the user's active fact set. Returns groups
 * (incl. corroborated ones) plus the auto-applied resolutions.
 */
export async function resolveUserConflicts(userId: string): Promise<{
  groups: ConflictGroup[];
  resolutions: ConflictResolution[];
}> {
  const facts = await prisma.factEvent.findMany({
    where: { userId, status: 'active' },
    orderBy: { observedAt: 'desc' },
  });

  const grouped = new Map<string, typeof facts>();
  for (const f of facts) {
    if (!f.metricKey) continue;
    const k = `${f.entity}::${normalizeMetricKey(f.metricKey)}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(f);
  }

  const groups: ConflictGroup[] = [];
  const resolutions: ConflictResolution[] = [];

  for (const [groupKey, members] of grouped) {
    if (members.length < 2) continue;
    const [entity, metricKey] = groupKey.split('::');

    const byValue = new Map<string, typeof members>();
    for (const f of members) {
      const vk = normalizeValue(f.metricValue ?? '');
      if (!vk) continue;
      if (!byValue.has(vk)) byValue.set(vk, []);
      byValue.get(vk)!.push(f);
    }

    const values: ConflictValue[] = [...byValue.entries()].map(([vk, fs]) => ({
      valueKey: vk,
      displayValue: fs[0].metricValue ?? vk,
      factIds: fs.map((f) => f.id),
      sources: [...new Set(fs.map((f) => f.sourceRef.split(':', 1)[0]))],
      latestObservedAt: latestOf(fs.map((f) => f.observedAt)),
    }));

    groups.push({
      entity,
      metricKey,
      values,
      totalFacts: members.length,
    });

    if (byValue.size === 1) continue; // pure corroboration → no resolution write

    // Recency wins: pick the value cluster with the latest observedAt;
    // tiebreak: largest cluster (more sources corroborate it).
    const ranked = [...values].sort((a, b) => {
      const ta = a.latestObservedAt?.getTime() ?? 0;
      const tb = b.latestObservedAt?.getTime() ?? 0;
      if (tb !== ta) return tb - ta;
      return b.factIds.length - a.factIds.length;
    });
    const winnerCluster = ranked[0];
    const winnerFactId = winnerCluster.factIds[0];
    const losers = ranked.slice(1).flatMap((v) => v.factIds);

    if (losers.length === 0) continue;

    await prisma.factEvent.updateMany({
      where: { id: { in: losers } },
      data: {
        status: 'superseded',
        notes: `superseded:recency:${winnerFactId}`,
      },
    });

    resolutions.push({
      entity,
      metricKey,
      winnerFactId,
      winnerValue: winnerCluster.displayValue,
      supersededFactIds: losers,
      reason: 'recency',
    });
  }

  return { groups, resolutions };
}

function normalizeMetricKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeValue(s: string): string {
  // Strip thousands separators / unit chars so "€127,000" === "€127.000" === "127000".
  return s
    .toLowerCase()
    .replace(/[\s,€$£¥]/g, '')
    .replace(/k\b/, '000')
    .replace(/m\b/, '000000')
    .trim();
}

function latestOf(dates: Array<Date | null>): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d.getTime() > best.getTime()) best = d;
  }
  return best;
}
