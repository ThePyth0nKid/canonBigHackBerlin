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
  /** Composite score (token + entity-boost). Stable across calls. */
  score: number;
  /** Why this row scored: e.g. ['entity:miller_group', 'token:industry']. */
  scoreReasons: string[];
}

export interface SearchOptions {
  workspace?: string;
  /** Hard cap on returned rows. Default 30. */
  limit?: number;
}

const ENTITY_BOOST = 10;

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
 * Run the actual ranked search. Returns up to `limit` rows; consumers may
 * keep all the SearchResult fields (MCP formatter wants the audit columns;
 * AskCanon's Gemini wants the prose ones).
 */
export async function searchFacts(
  userId: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const workspace = opts.workspace ?? 'inazuma';
  const limit = opts.limit ?? 30;

  const tokens = tokenize(query);
  const detectedEntities = await detectEntities(userId, workspace, query);
  if (tokens.length === 0 && detectedEntities.length === 0) return [];

  // Two queries, then merge — guarantees every detected-entity row is in
  // the candidate set even when broad keyword matches would otherwise crowd
  // them out under `take: 200 orderBy signedAt desc`. The cost is one extra
  // small DB call, irrelevant against the wider keyword fetch.
  const SELECT_SHAPE = {
    id: true, entity: true, claim: true, metricKey: true,
    metricValue: true, metricUnit: true, sourceRef: true,
    sourceExcerpt: true, signedAt: true, observedAt: true,
    eventHash: true, signerPubkey: true, parentHash: true,
  } as const;

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
