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
  status: 'active' | 'redacted' | 'superseded' | 'resolution';
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
  inazuma: 'Inazuma.co',
};

export const WORKSPACES = [
  {
    slug: 'inazuma',
    label: 'Inazuma.co',
    description: 'Your business · canonized across every source',
  },
] as const;

export type WorkspaceSlug = (typeof WORKSPACES)[number]['slug'];

const METRIC_LABELS: Record<string, string> = {
  industry: 'Industry',
  relationship_type: 'Relationship type',
  monthly_revenue: 'Monthly revenue',
  poc_product: 'POC product',
  primary_contact: 'Primary contact',
  vendor_scope: 'Vendor scope',
  customer_type: 'Customer type',
  role_category: 'Role category',
  social_post: 'Social post',
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

export interface FactStats {
  totalActive: number;
  totalSuperseded: number;
  totalRedacted: number;
  distinctSources: number;
  unresolvedConflicts: number;
  totalEntities: number;
}

export interface SourceStatus {
  /** sourceRef prefix this row covers (slack | gmail | pdf | qontext | resolution). */
  kind: string;
  displayName: string;
  /** What is this source bound to (account email, channel id, file name…). */
  account: string | null;
  /** The query / filter Canon applies when pulling from this source. */
  filter: string | null;
  /** ISO timestamp of the most-recent fact from this source — null if never synced. */
  lastFactAt: string | null;
  factCount: number;
  /** True if a credential is in place to actually pull from this source live. */
  ready: boolean;
}

/**
 * Fast aggregate stats for the page header — no per-row fetch. Runs as 4
 * count queries + 1 distinct-entity scan; ~50-200ms even on 8000+ facts.
 * Used as the first Suspense boundary so the header lights up immediately.
 */
export async function loadFactStats(
  userId: string,
  workspace: string = 'inazuma',
): Promise<FactStats> {
  const baseWhere = { userId, workspace, NOT: { status: 'resolution' } } as const;
  const [byStatus, distinctEntities, sourceRefs] = await Promise.all([
    prisma.factEvent.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
    }),
    prisma.factEvent.findMany({
      where: baseWhere,
      select: { entity: true },
      distinct: ['entity'],
    }),
    // Source-prefix discovery: pull distinct sourceRef and bucket by prefix
    // client-side. Cheaper than per-row fetch since each sourceRef is short.
    prisma.factEvent.findMany({
      where: baseWhere,
      select: { sourceRef: true },
      distinct: ['sourceRef'],
      take: 500,
    }),
  ]);

  const counts = { active: 0, superseded: 0, redacted: 0 };
  for (const r of byStatus) {
    const s = r.status as keyof typeof counts;
    if (s in counts) counts[s] = r._count._all;
  }
  const sourceSet = new Set(sourceRefs.map((r) => sourceKindOf(r.sourceRef)));

  // Conflicts can't be derived without grouping facts per (entity, metricKey)
  // and clustering by value — that's the slow path. Compute it lazily here:
  // groupBy (entity, metricKey, metricValue) is still much cheaper than
  // pulling every row, and gives us enough to count "groups with >1 value".
  const grouped = await prisma.factEvent.groupBy({
    by: ['entity', 'metricKey', 'metricValue'],
    where: { userId, workspace, status: 'active', metricKey: { not: null } },
    _count: { _all: true },
  });
  const valuesPerKey = new Map<string, Set<string>>();
  for (const g of grouped) {
    if (!g.metricKey) continue;
    const k = `${g.entity}::${normalizeMetricKey(g.metricKey)}`;
    const v = normalizeValue(g.metricValue ?? '');
    if (!v) continue;
    if (!valuesPerKey.has(k)) valuesPerKey.set(k, new Set());
    valuesPerKey.get(k)!.add(v);
  }
  let unresolvedConflicts = 0;
  for (const set of valuesPerKey.values()) if (set.size > 1) unresolvedConflicts++;

  return {
    totalActive: counts.active,
    totalSuperseded: counts.superseded,
    totalRedacted: counts.redacted,
    distinctSources: sourceSet.size,
    unresolvedConflicts,
    totalEntities: distinctEntities.length,
  };
}

/**
 * Per-source health for the "Connected sources" panel. Counts active facts
 * grouped by sourceRef prefix (slack/gmail/pdf/qontext) and joins each
 * row with a one-shot recency probe so the UI can render a "last sync"
 * timestamp without dragging the full ledger.
 *
 * Filters / accounts are rendered from env + DB lookups so the audience
 * can see EXACTLY what query Canon runs against each upstream.
 */
export async function loadSourceStatuses(
  userId: string,
  workspace: string = 'inazuma',
): Promise<SourceStatus[]> {
  const baseWhere = { userId, workspace, status: 'active' as const };

  // Group active facts by source prefix using sourceRef LIKE — Prisma's
  // groupBy doesn't support computed columns, so we do one count per kind.
  const kinds = ['slack', 'gmail', 'pdf', 'qontext'] as const;
  const perKind = await Promise.all(
    kinds.map(async (kind) => {
      const [count, latest] = await Promise.all([
        prisma.factEvent.count({
          where: { ...baseWhere, sourceRef: { startsWith: `${kind}:` } },
        }),
        prisma.factEvent.findFirst({
          where: { ...baseWhere, sourceRef: { startsWith: `${kind}:` } },
          orderBy: { signedAt: 'desc' },
          select: { signedAt: true, sourceRef: true },
        }),
      ]);
      return { kind, count, latest };
    }),
  );

  // Live Gmail account — pulled from the OAuth row NextAuth wrote when
  // the user signed in. Presence of access_token = "ready" for the live
  // adapter; absence (or missing scope) = degraded.
  const gmailAccount = await prisma.account.findFirst({
    where: { userId, provider: 'google', access_token: { not: null } },
    select: { scope: true },
  });
  const gmailUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const slackChannel = process.env.SLACK_DEMO_CHANNEL ?? 'C0B058UN0PK';
  const slackReady = !!process.env.SLACK_USER_TOKEN;

  const out: SourceStatus[] = [];
  for (const k of perKind) {
    const display: Record<typeof k.kind, { name: string; account: string | null; filter: string | null; ready: boolean }> = {
      slack: {
        name: 'Slack',
        account: `#sales · ${slackChannel}`,
        filter: 'conversations.history (latest 100 messages)',
        ready: slackReady,
      },
      gmail: {
        name: 'Gmail',
        account: gmailUser?.email ?? '(not signed in)',
        filter: 'subject:"[canon-demo]" (max 25 messages)',
        ready: !!gmailAccount && (gmailAccount.scope ?? '').includes('gmail.readonly'),
      },
      pdf: {
        name: 'PDF',
        account: 'demo/q1-board-deck.pdf (synthetic Q1 board deck)',
        filter: 'all pages',
        ready: true,
      },
      qontext: {
        name: 'Qontext dataset',
        account: 'demo/qontext/Dataset/* (synthetic Inazuma corp data)',
        filter: 'top-100 hero products + clients/vendors/policies/invoices',
        ready: true,
      },
    } as const;
    const meta = display[k.kind];
    out.push({
      kind: k.kind,
      displayName: meta.name,
      account: meta.account,
      filter: meta.filter,
      lastFactAt: k.latest?.signedAt?.toISOString() ?? null,
      factCount: k.count,
      ready: meta.ready,
    });
  }
  return out;
}

/**
 * Distinct entity slugs in canonical display order. Drives pagination —
 * page.tsx renders featured slugs immediately and hands the remaining tail
 * to the lazy loader.
 */
export async function loadEntitySlugsOrdered(
  userId: string,
  workspace: string = 'inazuma',
): Promise<string[]> {
  const rows = await prisma.factEvent.findMany({
    where: { userId, workspace, NOT: { status: 'resolution' } },
    select: { entity: true },
    distinct: ['entity'],
  });
  const slugs = rows.map((r) => r.entity);
  slugs.sort((a, b) => entityOrder(a) - entityOrder(b));
  return slugs;
}

/**
 * Build EntityGroup[] for ONLY the slugs requested. Caller-controlled
 * fan-out is the whole point: the initial page renders featured (~7
 * entities, ~100 facts), and "load more" actions fetch chunks of 25.
 * Avoids the 11MB / 1.5s wholesale fetch the original loader did.
 */
export async function loadEntitiesBySlugs(
  userId: string,
  workspace: string,
  slugs: string[],
): Promise<EntityGroup[]> {
  if (slugs.length === 0) return [];
  const rows = await prisma.factEvent.findMany({
    where: {
      userId,
      workspace,
      entity: { in: slugs },
      NOT: { status: 'resolution' },
    },
    orderBy: { signedAt: 'asc' },
  });
  const facts = rows.map(toFactRow);
  const byEntity = new Map<string, FactRow[]>();
  for (const f of facts) {
    if (!byEntity.has(f.entity)) byEntity.set(f.entity, []);
    byEntity.get(f.entity)!.push(f);
  }
  const out: EntityGroup[] = [];
  // Preserve caller-supplied slug order; missing slugs (no facts) are dropped.
  for (const slug of slugs) {
    const group = byEntity.get(slug);
    if (group) out.push(buildEntityGroup(slug, group));
  }
  return out;
}

export async function loadFactLandscape(
  userId: string,
  workspace: string = 'inazuma',
): Promise<FactLandscape> {
  const rows = await prisma.factEvent.findMany({
    where: { userId, workspace, NOT: { status: 'resolution' } },
    orderBy: { signedAt: 'asc' },
    take: 8000,
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
  const order = [
    // Northwind workspace primary entities
    'northwind', 'acme', 'techco', 'globex', 'initech', 'umbrella', 'soylent',
    // Inazuma workspace primary entity
    'inazuma',
    // Inazuma's "demo gold" entities — surface them above the alphabetical noise
    'miller_group', 'gonzalez_inc', 'johnson_group',
    'huang_llc', 'williams_group', 'martin_ltd',
  ];
  const i = order.indexOf(slug);
  return i < 0 ? 999 : i;
}

function metricOrder(key: string): number {
  const order = [
    // Northwind canonical
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
    // Inazuma canonical
    'industry',
    'relationship_type',
    'monthly_revenue',
    'poc_product',
    'primary_contact',
    'vendor_scope',
    'role_category',
    'customer_type',
  ];
  const i = order.indexOf(key);
  return i < 0 ? 999 : i;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
