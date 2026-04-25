/**
 * Server-side query helper that turns the raw FactEvent rows into the
 * entity-grouped, conflict-aware shape the /app UI consumes directly.
 */

import { prisma } from '@/lib/prisma';

export interface FactRow {
  id: string;
  entity: string;
  claim: string;
  metricKey: string | null;
  metricValue: string | null;
  metricUnit: string | null;
  sourceRef: string;
  sourceExcerpt: string | null;
  status: 'active' | 'redacted' | 'superseded';
  notes: string | null;
  parentHash: string | null;
  eventHash: string;
  signerPubkey: string;
  coseSign1Hex: string;
  signedAt: Date;
  observedAt: Date | null;
}

export interface MetricGroup {
  /** Slug of the metric (canonicalized) — e.g. "mrr", "renewal_date". */
  key: string;
  /** Most-recent winning value for the group. */
  winnerValue: string | null;
  /** Unit of the winning value (€, %, seats, ...). */
  winnerUnit: string | null;
  /** Human label (capitalized metric key for display). */
  label: string;
  /** Distinct source-kinds (slack/gmail/pdf) that confirm the winning value. */
  confirmingSources: string[];
  /** All active facts for this metric. */
  active: FactRow[];
  /** Superseded facts (recency-resolved or audit-flagged). */
  superseded: FactRow[];
  /** True when 2+ active facts share the winning value. */
  corroborated: boolean;
  /** True when there's an unresolved disagreement after auto-resolution. */
  needsHumanResolve: boolean;
}

export interface EntityGroup {
  slug: string;
  displayName: string;
  totalFacts: number;
  metrics: MetricGroup[];
  /** Free-form active facts that don't have a metric_key. */
  loose: FactRow[];
}

const ENTITY_DISPLAY: Record<string, string> = {
  northwind: 'Northwind Software',
  acme: 'ACME GmbH',
  techco: 'TechCo',
  globex: 'Globex',
  initech: 'Initech',
  umbrella: 'Umbrella',
  soylent: 'Soylent',
};

const METRIC_LABELS: Record<string, string> = {
  mrr: 'Q1 MRR',
  arr: 'ARR',
  acv: 'ACV',
  seats: 'Seats',
  renewal_date: 'Renewal date',
  pipeline: 'Q2 pipeline',
  churn: 'Churn',
  growth: 'YoY growth',
  forecast: 'Forecast',
  per_seat_price: 'Per-seat price',
  billing_cycle: 'Billing cycle',
};

export interface FactLandscape {
  entities: EntityGroup[];
  totalActive: number;
  totalSuperseded: number;
  totalRedacted: number;
  distinctSources: number;
  unresolvedConflicts: number;
}

export async function loadFactLandscape(userId: string): Promise<FactLandscape> {
  const rows = await prisma.factEvent.findMany({
    where: { userId },
    orderBy: { signedAt: 'asc' },
  });
  const facts = rows.map(toFactRow);

  const byEntity = new Map<string, FactRow[]>();
  for (const f of facts) {
    if (!byEntity.has(f.entity)) byEntity.set(f.entity, []);
    byEntity.get(f.entity)!.push(f);
  }

  const entities: EntityGroup[] = [];
  for (const [slug, group] of byEntity) {
    entities.push(buildEntityGroup(slug, group));
  }
  entities.sort((a, b) => entityOrder(a.slug) - entityOrder(b.slug));

  const sourceSet = new Set(facts.map((f) => sourceKindOf(f.sourceRef)));
  return {
    entities,
    totalActive: facts.filter((f) => f.status === 'active').length,
    totalSuperseded: facts.filter((f) => f.status === 'superseded').length,
    totalRedacted: facts.filter((f) => f.status === 'redacted').length,
    distinctSources: sourceSet.size,
    unresolvedConflicts: entities.reduce(
      (n, e) => n + e.metrics.filter((m) => m.needsHumanResolve).length,
      0,
    ),
  };
}

function buildEntityGroup(slug: string, facts: FactRow[]): EntityGroup {
  const byMetric = new Map<string, FactRow[]>();
  const loose: FactRow[] = [];
  for (const f of facts) {
    if (!f.metricKey) {
      if (f.status === 'active') loose.push(f);
      continue;
    }
    const k = normalizeMetricKey(f.metricKey);
    if (!byMetric.has(k)) byMetric.set(k, []);
    byMetric.get(k)!.push(f);
  }

  const metrics: MetricGroup[] = [];
  for (const [key, members] of byMetric) {
    metrics.push(buildMetricGroup(key, members));
  }
  metrics.sort((a, b) => metricOrder(a.key) - metricOrder(b.key));

  return {
    slug,
    displayName: ENTITY_DISPLAY[slug] ?? capitalize(slug),
    totalFacts: facts.length,
    metrics,
    loose,
  };
}

function buildMetricGroup(key: string, members: FactRow[]): MetricGroup {
  const active = members.filter((f) => f.status === 'active');
  const superseded = members.filter((f) => f.status === 'superseded');

  // Cluster active facts by normalized metricValue.
  const byValue = new Map<string, FactRow[]>();
  for (const f of active) {
    const vk = normalizeValue(f.metricValue ?? '');
    if (!vk) continue;
    if (!byValue.has(vk)) byValue.set(vk, []);
    byValue.get(vk)!.push(f);
  }

  const valueClusters = [...byValue.values()].sort((a, b) => {
    const ta = latestTime(a);
    const tb = latestTime(b);
    if (tb !== ta) return tb - ta;
    return b.length - a.length;
  });

  const winner = valueClusters[0]?.[0] ?? active[0];
  const winningCluster = valueClusters[0] ?? [];
  const confirmingSources = [
    ...new Set(winningCluster.map((f) => sourceKindOf(f.sourceRef))),
  ];

  return {
    key,
    label: METRIC_LABELS[key] ?? capitalize(key.replace(/_/g, ' ')),
    winnerValue: winner?.metricValue ?? null,
    winnerUnit: winner?.metricUnit ?? null,
    confirmingSources,
    active,
    superseded,
    corroborated: winningCluster.length >= 2,
    needsHumanResolve: byValue.size > 1,
  };
}

function toFactRow(r: {
  id: string;
  entity: string;
  claim: string;
  metricKey: string | null;
  metricValue: string | null;
  metricUnit: string | null;
  sourceRef: string;
  sourceExcerpt: string | null;
  status: string;
  notes: string | null;
  parentHash: string | null;
  eventHash: string;
  signerPubkey: string;
  coseSign1Hex: string;
  signedAt: Date;
  observedAt: Date | null;
}): FactRow {
  return {
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
  };
}

function sourceKindOf(sourceRef: string): string {
  return sourceRef.split(':', 1)[0];
}

function normalizeMetricKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeValue(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s,€$£¥]/g, '')
    .replace(/k\b/, '000')
    .replace(/m\b/, '000000')
    .trim();
}

function latestTime(rows: FactRow[]): number {
  let best = 0;
  for (const r of rows) {
    const t = r.observedAt?.getTime() ?? 0;
    if (t > best) best = t;
  }
  return best;
}

function entityOrder(slug: string): number {
  const order = ['northwind', 'acme', 'techco', 'globex', 'initech', 'umbrella', 'soylent'];
  const i = order.indexOf(slug);
  return i < 0 ? 999 : i;
}

function metricOrder(key: string): number {
  const order = [
    'mrr',
    'arr',
    'acv',
    'forecast',
    'pipeline',
    'growth',
    'seats',
    'renewal_date',
    'per_seat_price',
    'billing_cycle',
    'churn',
  ];
  const i = order.indexOf(key);
  return i < 0 ? 999 : i;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
