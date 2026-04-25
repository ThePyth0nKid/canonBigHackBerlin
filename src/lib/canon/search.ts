/**
 * Shared free-text search over signed FactEvents — single source of truth
 * for both the MCP server (`mcp/canon-mcp.ts`) and the Ask-Canon UI box
 * (`src/lib/canon/ask.ts`).
 *
 * Why a shared lib: the demo story is "you can ask the UI box OR Claude
 * Code via MCP — same retrieval code, same ranking, same answers". A
 * divergent implementation would silently break that promise.
 *
 * Ranking pipeline:
 *   1. Tokenize the query (drop stopwords, EN+DE, ≥3 chars).
 *   2. Detect known entity slugs in the query — looked up dynamically from
 *      the user's actual ledger (not a static alias map), so any new
 *      entity that lands in the DB is searchable by name on next call.
 *   3. Pull rows whose claim/sourceExcerpt/entity contains any token OR
 *      whose entity matches any detected slug.
 *   4. Score each row: +1 per token match across the three text fields,
 *      +10 if the row's entity is a detected entity slug. Tiebreak by
 *      signedAt desc.
 *   5. Take top-K.
 *
 * The entity-boost is the big behavioural fix: a question like
 * "primary contact of Miller Group" used to dilute miller_group's
 * facts under generic "primary contact" matches across the whole
 * ledger; now the boost concentrates the result set on the named
 * entity even when the broad terms outnumber its specific tokens.
 */

import { prisma } from '@/lib/prisma';

export interface SearchResult {
  id: string;
  entity: string;
  claim: string;
  metricKey: string | null;
  metricValue: string | null;
  metricUnit: string | null;
  sourceRef: string;
  sourceExcerpt: string | null;
  signedAt: Date;
  observedAt: Date | null;
  eventHash: string;
  signerPubkey: string;
  parentHash: string | null;
  /** Composite score (token + entity-boost OR cluster-size). */
  score: number;
  /** Why this row scored: e.g. ['entity:miller_group', 'token:industry']. */
  scoreReasons: string[];
  /** When the row came from a corroboration/conflict aggregation: the
   *  total number of facts in the cluster this row belongs to. Lets the
   *  Gemini caller render "18 facts agree on this price" without a
   *  follow-up query. */
  clusterCount?: number;
  /** What the row's cluster shape is: 'corroboration' (N facts same value)
   *  or 'conflict' (≥2 different values for same entity+metric). */
  clusterKind?: 'corroboration' | 'conflict';
}

export interface SearchOptions {
  workspace?: string;
  /** Hard cap on returned rows. Default 30. */
  limit?: number;
}

export type QueryIntent = 'standard' | 'corroboration' | 'conflict';

const ENTITY_BOOST = 10;
/** Minimum facts in a value-cluster to qualify as "corroborated" enough
 *  for the aggregation path. 3 = catalog + 2 corroborating sources;
 *  matches the demo's design (catalog + sales + invoices). */
const MIN_CORROBORATION = 3;
/** Cap on how many distinct clusters we surface per aggregation call.
 *  10 clusters × 5 sample facts = 50 rows handed to Gemini — comfortable
 *  fit in the 12kB prompt budget. */
const TOP_CLUSTERS = 10;
/** Sample facts per cluster handed to Gemini. We always include the
 *  cluster's full count in metadata so the model knows the total even if
 *  it only sees 5. */
const SAMPLE_PER_CLUSTER = 5;

/** Triggers the aggregation path. Bilingual; matches verbatim words AND
 *  whole-phrase variants. */
const CORROBORATION_INTENT_RE =
  /\b(corroborat|corroboration|agreed|agreement|consensus|aligned|consistent|confirmed|matching|most\s+(facts|sources|records|agreement)|strongest|highest\s+confidence|am\s+meisten|übereinstimm|übereinstimmend|konsens|bestätigt|einstimmig)/i;

const CONFLICT_INTENT_RE =
  /\b(conflict|conflicts|disagree|disagreement|contradict|contradiction|inconsistent|mismatched|widerspruch|widersprüchlich|widerspr|konflikt|konflikten?|uneinig)/i;

export function detectIntent(query: string): QueryIntent {
  if (CONFLICT_INTENT_RE.test(query)) return 'conflict';
  if (CORROBORATION_INTENT_RE.test(query)) return 'corroboration';
  return 'standard';
}

const STOPWORDS = new Set([
  // EN
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'to', 'is', 'are',
  'was', 'were', 'be', 'been', 'and', 'or', 'but', 'by', 'with', 'from',
  'as', 'about', 'this', 'that', 'these', 'those', 'it', 'its', 'has',
  'have', 'had', 'do', 'does', 'did', 'what', 'who', 'when', 'where',
  'why', 'how', 'which', 'whose', 'whom', 'tell', 'show', 'me', 'us',
  'we', 'our', 'i', 'you', 'your', 'all', 'any', 'some', 'every',
  // DE
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer',
  'eines', 'einem', 'einen', 'und', 'oder', 'aber', 'ist', 'sind',
  'war', 'waren', 'wer', 'wann', 'wo', 'warum', 'wie', 'welche',
  'welcher', 'welches', 'für', 'mit', 'von', 'zu', 'an', 'auf', 'über',
  'bei', 'aus', 'es', 'sein', 'seine', 'ich', 'du', 'er', 'sie',
  'wir', 'ihr', 'mir', 'dir', 'uns', 'euch', 'mich', 'dich',
  'nicht', 'kein', 'keine', 'nur', 'auch', 'noch', 'schon', 'sehr',
]);

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Pull the user's distinct active entity slugs from the ledger and detect
 * which ones appear in the query. Cheap (<100ms) — one DISTINCT query +
 * an in-memory whole-word substring scan over the lower-cased question.
 *
 * Each slug also gets a "spaced" variant: `miller_group` → `miller group`,
 * so questions written naturally ("Miller Group industry") match the
 * underscored DB slug.
 */
export async function detectEntities(
  userId: string,
  workspace: string,
  query: string,
): Promise<string[]> {
  // Normalise punctuation/letters → single-spaced lowercase, so questions
  // like "Miller Group?" or "Gonzalez Inc.relationship" still parse word
  // boundaries correctly. Without this, trailing punctuation glued to the
  // entity name killed the whole-word match.
  const normalized = ` ${query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
  const distinct = await prisma.factEvent.findMany({
    where: { userId, workspace, status: 'active' },
    select: { entity: true },
    distinct: ['entity'],
  });
  const detected = new Set<string>();
  for (const { entity } of distinct) {
    const slug = entity.toLowerCase();
    const spaced = slug.replace(/_/g, ' ');
    if (normalized.includes(` ${slug} `) || normalized.includes(` ${spaced} `)) {
      detected.add(entity);
    }
  }
  return [...detected];
}

/**
 * Run the actual ranked search. Dispatches by detected intent:
 *   - "corroboration" → SQL groupBy of (entity, metricKey, metricValue),
 *     surfaces the strongest agreement clusters with cluster-size metadata.
 *   - "conflict"      → SQL groupBy that surfaces (entity, metricKey)
 *     pairs with ≥2 distinct values; returns the competing facts.
 *   - "standard"      → keyword + entity-boost retrieval (existing path).
 *
 * The aggregation paths give Gemini a "see-the-shape-of-the-ledger"
 * view without forcing it to count clusters out of 30 random rows.
 * Cluster size is attached per-row so the prompt can render
 * "18 facts agree on this" verbatim.
 */
export async function searchFacts(
  userId: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const workspace = opts.workspace ?? 'inazuma';
  const limit = opts.limit ?? 30;
  const intent = detectIntent(query);

  if (intent === 'corroboration') {
    return searchByCorroboration(userId, workspace, query, limit);
  }
  if (intent === 'conflict') {
    return searchByConflict(userId, workspace, query, limit);
  }

  const tokens = tokenize(query);
  const detectedEntities = await detectEntities(userId, workspace, query);
  if (tokens.length === 0 && detectedEntities.length === 0) return [];

  // Two queries, then merge — guarantees every detected-entity row is in
  // the candidate set even when broad keyword matches would otherwise crowd
  // them out under `take: 200 orderBy signedAt desc`. The cost is one extra
  // small DB call, irrelevant against the wider keyword fetch.
  // (SELECT_SHAPE is defined once at module bottom and reused.)

  const tokenRows = tokens.length === 0
    ? []
    : await prisma.factEvent.findMany({
        where: {
          userId, workspace, status: 'active',
          OR: tokens.flatMap((t) => [
            { claim: { contains: t, mode: 'insensitive' as const } },
            { sourceExcerpt: { contains: t, mode: 'insensitive' as const } },
            { entity: { contains: t, mode: 'insensitive' as const } },
          ]),
        },
        select: SELECT_SHAPE,
        take: 200,
        orderBy: { signedAt: 'desc' },
      });
  const entityRows = detectedEntities.length === 0
    ? []
    : await prisma.factEvent.findMany({
        where: {
          userId, workspace, status: 'active',
          entity: { in: detectedEntities },
        },
        select: SELECT_SHAPE,
        orderBy: { signedAt: 'desc' },
      });

  // Dedupe by id, prefer entityRows first so they're guaranteed present.
  const seen = new Set<string>();
  const rows = [...entityRows];
  for (const r of entityRows) seen.add(r.id);
  for (const r of tokenRows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push(r);
  }

  const detectedSet = new Set(detectedEntities);
  const scored: SearchResult[] = rows.map((r) => {
    const reasons: string[] = [];
    let score = 0;

    if (detectedSet.has(r.entity)) {
      score += ENTITY_BOOST;
      reasons.push(`entity:${r.entity}`);
    }

    const hay = (r.claim + ' ' + (r.sourceExcerpt ?? '') + ' ' + r.entity).toLowerCase();
    for (const t of tokens) {
      if (hay.includes(t)) {
        score += 1;
        reasons.push(`token:${t}`);
      }
    }
    return { ...r, score, scoreReasons: reasons };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.signedAt.getTime() - a.signedAt.getTime();
  });

  return scored.slice(0, limit);
}

/* -------------------------------------------------------------------------- *
 * Aggregation paths — corroboration & conflict
 * -------------------------------------------------------------------------- */

const SELECT_SHAPE = {
  id: true, entity: true, claim: true, metricKey: true,
  metricValue: true, metricUnit: true, sourceRef: true,
  sourceExcerpt: true, signedAt: true, observedAt: true,
  eventHash: true, signerPubkey: true, parentHash: true,
} as const;

/**
 * Group by (entity, metricKey, metricValue) and surface the largest
 * value-clusters. Each cluster represents N independent signed facts that
 * agree on the same value — exactly the "corroborated price" demo beat.
 *
 * Returns up to TOP_CLUSTERS clusters × SAMPLE_PER_CLUSTER facts each.
 * Each row carries the cluster's full count in `clusterCount` so the
 * Gemini caller can say "18 facts agree" even when only 5 are shown.
 *
 * Optionally narrows by entity if the question names known entities
 * (so "products with most corroborated price" stays on products even if
 * a Slack channel happens to have a bigger cluster).
 */
async function searchByCorroboration(
  userId: string,
  workspace: string,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  // If the question names entities, scope to them so we don't drown the
  // signal in unrelated big clusters.
  const detectedEntities = await detectEntities(userId, workspace, query);

  const baseWhere = {
    userId, workspace, status: 'active' as const,
    metricKey: { not: null },
    ...(detectedEntities.length > 0 ? { entity: { in: detectedEntities } } : {}),
  };

  const clusters = await prisma.factEvent.groupBy({
    by: ['entity', 'metricKey', 'metricValue'],
    where: baseWhere,
    _count: { _all: true },
  });

  const top = clusters
    .filter((c) => c._count._all >= MIN_CORROBORATION)
    .sort((a, b) => b._count._all - a._count._all)
    .slice(0, TOP_CLUSTERS);

  if (top.length === 0) return [];

  // Fetch sample facts for each top cluster in parallel — one query per
  // cluster, capped at SAMPLE_PER_CLUSTER. Cheap (10 small queries).
  const factGroups = await Promise.all(
    top.map((c) =>
      prisma.factEvent.findMany({
        where: {
          userId, workspace, status: 'active',
          entity: c.entity,
          metricKey: c.metricKey ?? '',
          metricValue: c.metricValue,
        },
        select: SELECT_SHAPE,
        take: SAMPLE_PER_CLUSTER,
        orderBy: { signedAt: 'asc' },
      }),
    ),
  );

  const out: SearchResult[] = [];
  factGroups.forEach((rows, i) => {
    const clusterCount = top[i]._count._all;
    for (const r of rows) {
      out.push({
        ...r,
        score: clusterCount,
        scoreReasons: [`corroboration:${clusterCount}_facts`],
        clusterCount,
        clusterKind: 'corroboration',
      });
    }
  });

  return out.slice(0, limit);
}

/**
 * Group by (entity, metricKey) and surface pairs with ≥2 distinct values.
 * Each surfaced row belongs to a competing-claim cluster — exactly the
 * Miller Group industry / Gonzalez Inc tier demo beat.
 *
 * Sample 1 fact per (entity, metricKey, metricValue) so Gemini sees the
 * shape: "miller_group.industry has 2 values: Manufacturing [f_…] vs
 * Entertainment [f_…]".
 */
async function searchByConflict(
  userId: string,
  workspace: string,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const detectedEntities = await detectEntities(userId, workspace, query);

  const baseWhere = {
    userId, workspace, status: 'active' as const,
    metricKey: { not: null },
    ...(detectedEntities.length > 0 ? { entity: { in: detectedEntities } } : {}),
  };

  const triples = await prisma.factEvent.groupBy({
    by: ['entity', 'metricKey', 'metricValue'],
    where: baseWhere,
    _count: { _all: true },
  });

  // Roll up to (entity, metricKey) → set of values.
  const byPair = new Map<string, { entity: string; metricKey: string; values: { value: string | null; count: number }[] }>();
  for (const t of triples) {
    const k = `${t.entity}::${t.metricKey ?? ''}`;
    if (!byPair.has(k)) {
      byPair.set(k, { entity: t.entity, metricKey: t.metricKey ?? '', values: [] });
    }
    byPair.get(k)!.values.push({ value: t.metricValue, count: t._count._all });
  }

  const conflicts = [...byPair.values()]
    .filter((p) => p.values.length >= 2)
    .sort((a, b) => b.values.length - a.values.length)
    .slice(0, TOP_CLUSTERS);

  if (conflicts.length === 0) return [];

  // For each conflict pair, fetch one fact per competing value so Gemini
  // can show "Manufacturing [f_…] vs Entertainment [f_…]".
  const factGroups = await Promise.all(
    conflicts.flatMap((p) =>
      p.values.map((v) =>
        prisma.factEvent.findFirst({
          where: {
            userId, workspace, status: 'active',
            entity: p.entity,
            metricKey: p.metricKey,
            metricValue: v.value,
          },
          select: SELECT_SHAPE,
          orderBy: { signedAt: 'desc' },
        }),
      ),
    ),
  );

  // Re-associate fetched facts with their conflict pair for clusterCount.
  const out: SearchResult[] = [];
  let cursor = 0;
  for (const p of conflicts) {
    const totalDistinct = p.values.length;
    for (const _ of p.values) {
      const r = factGroups[cursor++];
      if (!r) continue;
      out.push({
        ...r,
        score: totalDistinct,
        scoreReasons: [`conflict:${totalDistinct}_distinct_values`],
        clusterCount: totalDistinct,
        clusterKind: 'conflict',
      });
    }
  }

  return out.slice(0, limit);
}
