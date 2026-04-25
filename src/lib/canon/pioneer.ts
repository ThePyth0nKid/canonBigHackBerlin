/**
 * Pioneer / Fastino GLiNER-2 client — Layer 1 of the Trust Pipeline.
 *
 * GLiNER-2 is a span extractor: it returns verbatim substrings from input,
 * not generated text. Strategy: feed pre-chunked text (one fact-bearing
 * sentence/paragraph per chunk), have Pioneer pull out the entity+metric
 * spans, and use the chunk itself as the FactDraft.claim.
 *
 * Verified endpoint: POST https://api.pioneer.ai/gliner-2 (X-API-Key auth).
 * api.fastino.ai (the SDK default) had an expired SSL cert as of 2026-04.
 */

import type { FactDraft } from './types';

const PIONEER_BASE_URL = process.env.PIONEER_BASE_URL ?? 'https://api.pioneer.ai';
const PIONEER_PATH = '/gliner-2';
const DEFAULT_THRESHOLD = 0.3;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BATCH = 16;

/** GLiNER-2 schema field spec: "name::dtype::description" (dtype = str | list). */
type FieldSpec = string;

interface PioneerRequest {
  task: 'extract_json' | 'extract_entities' | 'classify_text' | 'schema';
  text: string | string[];
  schema: Record<string, FieldSpec[]> | string[] | { categories: string[] };
  threshold?: number;
  include_confidence?: boolean;
  include_spans?: boolean;
  format_results?: boolean;
}

interface RawFactRow {
  entity?: string | null;
  metric_key?: string | null;
  metric_value?: string | null;
  metric_unit?: string | null;
  observed_at?: string | null;
}

interface RawResultBlock {
  fact?: RawFactRow[];
  [k: string]: unknown;
}

interface PioneerResponse {
  /** result is an object for single-text, an array for batch text. */
  result: RawResultBlock | RawResultBlock[];
  token_usage?: number;
}

/** The schema we hand Pioneer per-chunk. Fields are span-only (verbatim). */
const FACT_SCHEMA: Record<string, FieldSpec[]> = {
  fact: [
    'entity::str::verbatim company or customer name as written (Northwind, ACME, TechCo, Globex, Initech)',
    'metric_key::str::verbatim short metric label (MRR, ARR, seats, renewal, churn, growth, pipeline, ACV)',
    'metric_value::str::verbatim numeric or date value (e.g. 127,000 or 2026-05-15 or 50)',
    'metric_unit::str::verbatim unit (€, %, seats, /mo, /yr)',
    'observed_at::str::ISO date the fact pertains to if explicit in the text',
  ],
};

/**
 * Canonical entity map for the Northwind demo cast.
 * GLiNER spans are matched (case-insensitive, trimmed) against the values.
 * Anything outside this map is treated as noise and the draft is dropped.
 */
const ENTITY_ALIASES: Record<string, string[]> = {
  northwind: ['northwind', 'northwind software', 'northwind sw'],
  acme: ['acme', 'acme gmbh', 'acme corp'],
  techco: ['techco', 'tech co'],
  globex: ['globex'],
  initech: ['initech'],
  umbrella: ['umbrella'],
  soylent: ['soylent'],
};

const ENTITY_REVERSE: Map<string, string> = new Map(
  Object.entries(ENTITY_ALIASES).flatMap(([slug, aliases]) =>
    aliases.map((a) => [a.toLowerCase(), slug] as const),
  ),
);

export class PioneerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'PioneerError';
  }
}

export interface Chunk {
  /** Raw text the sentence/paragraph contains. Becomes FactDraft.claim. */
  text: string;
  /** Stable per-chunk pointer, e.g. "slack:C0B058UN0PK:1713600000.000100". */
  sourceRef: string;
  /** ISO timestamp the source asserts. Falls back if Pioneer doesn't extract one. */
  observedAt: string;
  /** Optional verbatim excerpt for citation. Defaults to a clipped `text`. */
  sourceExcerpt?: string;
  /**
   * Source-implied entity when Pioneer doesn't find a known one verbatim.
   * E.g. internal team Slack about "Q1 MRR €127k" implies entity=`northwind`,
   * even though "Northwind" isn't said in the message.
   */
  defaultEntity?: string;
  /**
   * Extra text consulted by post-processing for customer-detection only
   * (not sent to Pioneer). Used to carry an email subject across sentences.
   */
  entityContext?: string;
}

/**
 * Run Pioneer over a batch of pre-chunked text and return FactDrafts.
 * Each chunk produces 0 or 1 drafts: 1 if Pioneer found a known canonical
 * entity, 0 otherwise (drift / noise gets filtered).
 *
 * Chunks are split per-sentence first — GLiNER-2 returns ONE fact per text,
 * so multi-metric inputs (e.g. "Q1 €127k MRR. Up 23% YoY.") would otherwise
 * lose half their metrics. Per-sentence chunking keeps each fact laser-clean.
 */
export async function extractFactsFromChunks(
  chunks: Chunk[],
  opts?: { threshold?: number },
): Promise<FactDraft[]> {
  const filtered = chunks
    .flatMap(splitChunkPerSentence)
    .filter((c) => c.text.trim().length > 0);
  if (filtered.length === 0) return [];

  const drafts: FactDraft[] = [];
  for (let i = 0; i < filtered.length; i += MAX_BATCH) {
    const batch = filtered.slice(i, i + MAX_BATCH);
    const resp = await callPioneer({
      task: 'extract_json',
      text: batch.map((c) => c.text),
      schema: FACT_SCHEMA,
      threshold: opts?.threshold ?? DEFAULT_THRESHOLD,
      format_results: true,
    });
    const blocks = Array.isArray(resp.result) ? resp.result : [resp.result];

    batch.forEach((chunk, idx) => {
      const raw = blockToDraft(blocks[idx], chunk);
      const cleaned = postProcessDraft(raw, chunk);
      for (const d of cleaned) drafts.push(d);
    });
  }
  return drafts;
}

/* -------------------------------------------------------------------------- *
 * Post-processing layer
 *
 * GLiNER-2 spans are noisy: it confuses metric_value with metric_key, attaches
 * facts to whichever entity is named loudest in the chunk, and lets timestamp-
 * shaped strings leak into the schema. The rules below clean the raw draft
 * into 0, 1, or 2 demo-grade FactDrafts.
 * -------------------------------------------------------------------------- */

/** Metrics that always belong to the home org (Northwind in the demo). */
const HOUSE_METRICS = new Set([
  'mrr',
  'arr',
  'pipeline',
  'forecast',
  'growth',
  'headcount',
]);

/** Metrics that always belong to a specific customer, never the home org. */
const CUSTOMER_METRICS = new Set([
  'seats',
  'acv',
  'renewal_date',
  'billing_cycle',
  'churn',
  'per_seat_price',
]);

/** Metric keys that require a digit somewhere in the value. */
const NUMERIC_METRICS = new Set([
  'mrr',
  'arr',
  'acv',
  'seats',
  'pipeline',
  'forecast',
  'growth',
  'headcount',
  'per_seat_price',
  'churn',
]);

const KNOWN_CUSTOMERS = ['acme', 'techco', 'globex', 'initech', 'umbrella', 'soylent'];

/** "q1_2026", "q4_2025", "2026", or bare "q1" — junk metric keys that are really period labels. */
const PERIOD_KEY_RE = /^(q[1-4](_?20\d{2})?|20\d{2})$/i;

/** Final whitelist — drafts whose metricKey isn't here get dropped. */
const ALLOWED_METRIC_KEYS = new Set([
  'mrr',
  'arr',
  'acv',
  'seats',
  'renewal_date',
  'pipeline',
  'churn',
  'growth',
  'forecast',
  'per_seat_price',
  'billing_cycle',
  'headcount',
]);

/** Match "<N> seats" / "<N>-seat" anywhere in the chunk. */
const SEATS_PATTERN = /\b(\d{1,4})\s*-?\s*seats?\b/i;

/** Match "€<N>k?" amounts; optional k/m suffix only if word-boundary follows. */
const MONEY_PATTERN = /€\s*([\d.,]+(?:\s*[km](?=\s|$|[^a-z]))?)/i;

/** Match "<N> FTE" / "<N>-person team". */
const FTE_PATTERN = /\b(\d{1,4})\s*(?:fte|fulltime|full-time)\b|\b(\d{1,4})-person\b/i;

/**
 * Clean a Pioneer draft. Returns:
 *   []    — drop noise
 *   [d]   — usual case
 *   [a,b] — split (TechCo: seats + churn from one chunk)
 */
function postProcessDraft(draft: FactDraft | null, chunk: Chunk): FactDraft[] {
  if (!draft) return [];

  const text = chunk.text;
  const lc = text.toLowerCase();
  // Include any entityContext (carried-forward subject/title) for customer
  // detection, but NOT for value/seat regexes that should match the sentence.
  const lcForEntity = (chunk.entityContext ?? '').toLowerCase() + ' ' + lc;
  const customers = detectCustomersInText(lcForEntity);

  let metricKey = draft.metric?.key ?? null;
  let metricValue = draft.metric?.value ?? '';
  let metricUnit = draft.metric?.unit;
  let entity = draft.entity;

  // (c) Drop time-period metric keys outright.
  if (metricKey && PERIOD_KEY_RE.test(metricKey.replace(/\s+/g, '_'))) {
    return [];
  }

  // (c-bis) Drop when metric_value is itself a time period label.
  if (/^q[1-4]\s*20\d{2}$/i.test(metricValue.trim())) {
    return [];
  }

  // Drop multiplier-style values like "3.7x" — never a real metric for the demo.
  if (/^\d+(\.\d+)?x$/i.test(metricValue.trim())) {
    return [];
  }

  const seatsMatch = text.match(SEATS_PATTERN);
  const fteMatch = text.match(FTE_PATTERN);
  const isChurnContext = /\b(churn|cancell|mrr lost|mrr loss|seats?\s+gek|gek[uü]ndigt)\b/i.test(
    text,
  );

  // === Strong rerouting rules (fire BEFORE entity correction) ============= //

  // (e) Customer-churn line — "12 seats × €200/mo = €2,400 MRR lost".
  // Conservative: only fire when the chunk has a strong churn cue AND an
  // explicit "MRR lost" / "lost" euro amount. Emits churn + seats drafts as
  // ADDITIONS — the original draft is reprocessed afterward.
  const strongChurnCue =
    /\b(churning|churned|cancellation|mrr\s+lost|seats?\s+gek|gek[uü]ndigt|competitive\s+loss)\b/i.exec(
      text,
    );
  const additions: FactDraft[] = [];
  if (strongChurnCue) {
    const onlyCustomers = customers.filter((c) => c !== 'northwind');
    if (onlyCustomers.length > 0) {
      const customer = nearestCustomer(
        text,
        lc,
        strongChurnCue.index,
        onlyCustomers,
      );
      // Euro amount that's explicitly tagged as "MRR lost" or follows "lost".
      const lostMatch =
        text.match(/€\s*([\d.,]+\s*k?)(?=\s*(?:mrr\s+lost|\s+lost\b))/i) ??
        text.match(/mrr\s+lost[^€]*€\s*([\d.,]+\s*k?)/i) ??
        text.match(/lost[^€]{0,40}€\s*([\d.,]+\s*k?)/i) ??
        // "12 seats, €2,400 MRR" pattern (PDF risk slide)
        text.match(/seats?,\s*€\s*([\d.,]+\s*k?)\s*mrr/i);
      const seatN = seatsMatch?.[1];
      if (lostMatch) {
        const n = normalizeMoneyValue(`€${lostMatch[1].trim()}`, '/mo');
        additions.push({
          ...draft,
          entity: customer,
          metric: { key: 'churn', value: n.value, unit: n.unit },
          sourceRef: `${draft.sourceRef}#churn`,
        });
      }
      if (seatN) {
        additions.push({
          ...draft,
          entity: customer,
          metric: { key: 'seats', value: seatN, unit: 'seats' },
          sourceRef: `${draft.sourceRef}#seats`,
        });
      }
    }
  }

  // (f) FTE / headcount — "18 FTE", "10-person team". Always northwind.
  if (fteMatch) {
    return [
      {
        ...draft,
        entity: 'northwind',
        metric: {
          key: 'headcount',
          value: (fteMatch[1] ?? fteMatch[2] ?? '').trim(),
          unit: 'FTE',
        },
      },
    ];
  }

  // (d) Seats normalization: chunk has "<N> seats" + a customer in scope.
  // Don't fire when the chunk also describes ACV/per-seat-price/renewal —
  // Pioneer's existing extraction is more reliable for those.
  if (
    seatsMatch &&
    customers.some((c) => c !== 'northwind') &&
    metricKey !== 'per_seat_price' &&
    metricKey !== 'acv' &&
    metricKey !== 'renewal_date' &&
    metricKey !== 'billing_cycle'
  ) {
    const onlyCustomers = customers.filter((c) => c !== 'northwind');
    const customer = nearestCustomer(text, lc, seatsMatch.index ?? 0, onlyCustomers);
    entity = customer;
    metricKey = 'seats';
    metricValue = seatsMatch[1];
    metricUnit = 'seats';
  }

  // Email-subject seat hedge: "could come in at 40", "early sizing 40 seats"
  // when chunk header mentions a customer. Use a looser pattern.
  if (
    !seatsMatch &&
    metricKey !== 'seats' &&
    customers.some((c) => c !== 'northwind') &&
    /\b(seat|seats|sizing)\b/i.test(text)
  ) {
    const looseSeat = text.match(/\b(?:at|around|about|of|to|sizing)\s+(\d{1,3})\b/i);
    if (looseSeat) {
      const onlyCustomers = customers.filter((c) => c !== 'northwind');
      entity = onlyCustomers[0];
      metricKey = 'seats';
      metricValue = looseSeat[1];
      metricUnit = 'seats';
    }
  }

  // If we synthesized churn/seats additions, drop the original draft when it
  // duplicates one of the new metric keys — Pioneer's churn span is usually
  // the per-seat price not the total lost amount. Also drop when the original
  // claimed northwind.mrr in a churn-context chunk: that's the lost-MRR amount
  // mis-attributed to the home org.
  const additionKinds = new Set(additions.map((a) => a.metric!.key));
  if (additions.length > 0 && metricKey && additionKinds.has(metricKey)) {
    return additions;
  }
  // Strong churn cues capture the churn euro amount as `additions`. The
  // original draft's mrr/arr in such a chunk is the lost-MRR figure mis-routed
  // to a house metric — drop it regardless of which entity Pioneer guessed,
  // because entity correction would otherwise pull it back to northwind.
  if (
    additions.length > 0 &&
    strongChurnCue &&
    (metricKey === 'mrr' || metricKey === 'arr')
  ) {
    return additions;
  }
  // If Pioneer tagged a price as "seats", reroute to per_seat_price.
  if (metricKey === 'seats' && /[€$]/.test(metricValue)) {
    metricKey = 'per_seat_price';
    metricUnit = metricUnit ?? '/yr';
  }

  // === Whitelist gate ====================================================== //
  if (!metricKey || !ALLOWED_METRIC_KEYS.has(metricKey)) {
    return additions;
  }

  // (b) Numeric metrics require a digit in value.
  if (NUMERIC_METRICS.has(metricKey) && !/\d/.test(metricValue)) {
    return additions;
  }

  // mrr/arr/acv/forecast/pipeline/churn must look like money — at least 3
  // digits, or contain € / , / k / m. Bare small ints like "23" are usually
  // growth %; "1-2" is a count-of-things, not a euro value.
  if (
    (metricKey === 'mrr' ||
      metricKey === 'arr' ||
      metricKey === 'acv' ||
      metricKey === 'forecast' ||
      metricKey === 'pipeline' ||
      metricKey === 'churn') &&
    !/[€,km]/i.test(metricValue) &&
    !/\d{3,}/.test(metricValue)
  ) {
    return additions;
  }

  // === Entity correction by metric kind ==================================== //

  if (HOUSE_METRICS.has(metricKey)) {
    // House metric on a customer — pull back to northwind.
    if (KNOWN_CUSTOMERS.includes(entity)) {
      entity = 'northwind';
    }
  } else if (CUSTOMER_METRICS.has(metricKey)) {
    // Customer metric — must be a real customer.
    if (entity === 'northwind' || !KNOWN_CUSTOMERS.includes(entity)) {
      const onlyCustomers = customers.filter((c) => c !== 'northwind');
      if (onlyCustomers.length === 0) return [];
      entity = onlyCustomers[0];
    }
  }

  // === Drop pipeline noise ================================================ //
  // "3 logos in procurement", "3 new logos" — pipeline unit "logos" not euros.
  if (metricKey === 'pipeline' && /\b(logos?|deals?)\b/i.test(metricUnit ?? '')) {
    return [];
  }
  if (metricKey === 'pipeline' && !/[€$]|\d{3,}/.test(metricValue)) {
    return [];
  }

  // === Unit / value normalization ========================================= //
  const norm = normalizeMoneyValue(metricValue, metricUnit);
  metricValue = norm.value;
  metricUnit = norm.unit;

  if (NUMERIC_METRICS.has(metricKey) && !/\d/.test(metricValue)) {
    return [];
  }

  if (!metricValue) return additions;

  return [
    {
      ...draft,
      entity,
      metric: { key: metricKey, value: metricValue, unit: metricUnit },
    },
    ...additions,
  ];
}

/** Return the customer slugs (plus 'northwind') named in the chunk text. */
function detectCustomersInText(lc: string): string[] {
  const found: string[] = [];
  for (const slug of [...KNOWN_CUSTOMERS, 'northwind']) {
    const aliases = ENTITY_ALIASES[slug] ?? [slug];
    for (const a of aliases) {
      if (lc.includes(a.toLowerCase())) {
        if (!found.includes(slug)) found.push(slug);
        break;
      }
    }
  }
  return found;
}

/**
 * Pick the customer whose name appears most-recently BEFORE the given offset
 * (preferred — labels typically come before their values). If no customer
 * appears before, fall back to the nearest one anywhere.
 */
function nearestCustomer(
  text: string,
  lc: string,
  anchor: number,
  candidates: string[],
): string {
  let bestBefore: string | null = null;
  let bestBeforePos = -1;
  let bestAny: string | null = null;
  let bestAnyDist = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (c === 'northwind') continue;
    const aliases = ENTITY_ALIASES[c] ?? [c];
    for (const a of aliases) {
      const lcA = a.toLowerCase();
      // Find the last occurrence at or before anchor.
      const before = lc.lastIndexOf(lcA, anchor);
      if (before >= 0 && before > bestBeforePos) {
        bestBeforePos = before;
        bestBefore = c;
      }
      const any = lc.indexOf(lcA);
      if (any >= 0) {
        const d = Math.abs(any - anchor);
        if (d < bestAnyDist) {
          bestAnyDist = d;
          bestAny = c;
        }
      }
    }
  }
  return bestBefore ?? bestAny ?? candidates[0];
}

/**
 * Expand "127k" → "127000", "€2.4k" → "€2400", strip trailing "/mo" into unit.
 * Leaves dates and percentages alone.
 */
function normalizeMoneyValue(
  value: string,
  unit: string | undefined,
): { value: string; unit: string | undefined } {
  let v = value.trim();
  let u = unit;

  // Strip "/mo" or "/yr" suffix into unit.
  const slashMatch = v.match(/(\/(?:mo|yr|month|year))\s*$/i);
  if (slashMatch) {
    v = v.slice(0, slashMatch.index).trim();
    u = u ?? slashMatch[1].toLowerCase();
  }

  // Expand "<num>k" / "<num>m" forms when the value is purely currency-shaped.
  // Skip dates and percentages.
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return { value: v, unit: u };
  if (/%$/.test(v)) return { value: v, unit: u };

  // "127k" → 127000. Require k/m to be the LAST char of the value, not just
  // a word-boundary letter — otherwise "127,000 MRR" would normalize as "M".
  const kMatch = v.match(/^€?\s*([\d.,]+)\s*k$/i);
  if (kMatch) {
    const n = Number(kMatch[1].replace(/,/g, ''));
    if (Number.isFinite(n)) {
      const expanded = Math.round(n * 1000).toString();
      v = v.startsWith('€') ? `€${expanded}` : expanded;
    }
  }
  const mMatch = v.match(/^€?\s*([\d.,]+)\s*m$/i);
  if (mMatch && !kMatch) {
    const n = Number(mMatch[1].replace(/,/g, ''));
    if (Number.isFinite(n)) {
      const expanded = Math.round(n * 1_000_000).toString();
      v = v.startsWith('€') ? `€${expanded}` : expanded;
    }
  }

  return { value: v, unit: u };
}

function blockToDraft(block: RawResultBlock | undefined, chunk: Chunk): FactDraft | null {
  const row = block?.fact?.[0];
  const metricKeyRaw = (row?.metric_key ?? '').toString().trim();
  const metricValue = (row?.metric_value ?? '').toString().trim();
  const metricUnit = (row?.metric_unit ?? '').toString().trim() || undefined;

  // Pioneer often confuses numeric values into the metric_key field. Try to
  // canonicalize against a known label set; if the span is itself numeric or
  // unmappable, infer a key from the chunk text instead.
  const metricKey =
    canonicalizeMetricKey(metricKeyRaw) ?? inferMetricKeyFromText(chunk.text, metricValue);

  const metric =
    metricKey && metricValue
      ? { key: metricKey, value: metricValue, unit: metricUnit }
      : undefined;

  const entitySpan = (row?.entity ?? '').toString().trim();
  const slugFromSpan = entitySpan ? canonicalizeEntity(entitySpan) : null;
  // Fall back to the source-implied entity if the span miss / drifts —
  // but only when there's an actual metric to anchor the fact.
  const slug =
    slugFromSpan ??
    (metric && chunk.defaultEntity ? chunk.defaultEntity : null);
  if (!slug) return null;

  const rawObserved = (row?.observed_at ?? '').toString().trim();
  const observedAt = isPlausibleIsoDate(rawObserved) ? rawObserved : chunk.observedAt;
  const claim = oneLine(chunk.text);

  return {
    entity: slug,
    claim,
    metric,
    sourceRef: chunk.sourceRef,
    sourceExcerpt: chunk.sourceExcerpt ?? clip(chunk.text, 240),
    observedAt,
  };
}

/** Canonical metric-key vocabulary for the Northwind demo. */
const METRIC_ALIASES: Record<string, string[]> = {
  mrr: ['mrr', 'monthly recurring revenue', 'q1 mrr', 'q2 mrr', 'monthly revenue'],
  arr: ['arr', 'annual recurring revenue'],
  acv: ['acv', 'annual contract value'],
  seats: ['seats', 'seat count', 'licenses', 'users'],
  renewal_date: ['renewal', 'renewal date', 'renewal effective', 'next renewal'],
  pipeline: ['pipeline', 'q2 pipeline', 'weighted pipeline', 'pipeline weighted'],
  churn: ['churn', 'churning', 'churned', 'mrr lost', 'mrr loss', 'cancellation'],
  growth: ['growth', 'yoy growth', 'yoy', 'year over year'],
  forecast: ['forecast', 'q1 forecast', 'feb forecast', 'february forecast'],
  per_seat_price: ['per seat', 'per-seat price', 'per-seat', 'price per seat', '€/seat'],
  billing_cycle: ['billing', 'billing cycle', 'annual billing'],
};

const METRIC_REVERSE: Map<string, string> = new Map(
  Object.entries(METRIC_ALIASES).flatMap(([slug, aliases]) =>
    aliases.map((a) => [a.toLowerCase(), slug] as const),
  ),
);

const NUMERIC_LIKE = /^[\s\d.,€$£¥%\-+/]+$/;

function canonicalizeMetricKey(raw: string): string | null {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase().replace(/[.,;:!?]+$/, '');
  if (!norm) return null;
  if (NUMERIC_LIKE.test(norm)) return null;
  if (METRIC_REVERSE.has(norm)) return METRIC_REVERSE.get(norm)!;
  for (const [alias, slug] of METRIC_REVERSE) {
    if (norm.includes(alias)) return slug;
  }
  // Unknown but non-numeric — keep the lowercased form as a soft slug.
  return norm.replace(/\s+/g, '_').slice(0, 32);
}

/**
 * Pioneer didn't give us a usable key. Walk the chunk text once and detect
 * the strongest metric category present.
 */
function inferMetricKeyFromText(text: string, value: string): string | null {
  const lc = text.toLowerCase();
  if (/\bmrr\b/.test(lc)) return 'mrr';
  if (/\barr\b/.test(lc)) return 'arr';
  if (/\bacv\b/.test(lc)) return 'acv';
  if (/\brenewal\b/.test(lc) && /\d{4}-\d{2}-\d{2}/.test(value)) return 'renewal_date';
  if (/\bseats?\b/.test(lc)) return 'seats';
  if (/\bpipeline\b/.test(lc)) return 'pipeline';
  if (/\bchurn|cancellation\b/.test(lc)) return 'churn';
  if (/\byoy\b|year[- ]over[- ]year/.test(lc) || /\d+\s*%/.test(value)) return 'growth';
  if (/\bforecast\b/.test(lc)) return 'forecast';
  if (/\bbilling\b/.test(lc)) return 'billing_cycle';
  return null;
}

/** ISO-like date check: YYYY-MM-DD, YYYY-MM, or full ISO8601. */
function isPlausibleIsoDate(s: string): boolean {
  if (!s) return false;
  if (!/^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2})?)?)?$/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

export function canonicalizeEntity(span: string): string | null {
  const norm = span.trim().toLowerCase().replace(/[.,;:!?]+$/, '');
  if (!norm) return null;
  if (ENTITY_REVERSE.has(norm)) return ENTITY_REVERSE.get(norm)!;
  for (const [alias, slug] of ENTITY_REVERSE) {
    if (norm === alias) return slug;
    // tolerate trailing tokens like "ACME GmbH"
    if (norm.startsWith(alias + ' ') || norm.endsWith(' ' + alias)) return slug;
  }
  return null;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split a chunk's text into sentences and emit one sub-chunk per sentence,
 * each with a unique sourceRef suffix so the chain still hashes distinctly.
 * Drops trivially-short fragments (<25 chars) — those rarely carry a metric.
 */
function splitChunkPerSentence(chunk: Chunk): Chunk[] {
  const sentences = chunk.text
    .split(/(?<=[.!?])\s+(?=[A-Z€$£0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);

  if (sentences.length <= 1) return [chunk];

  // The first sentence often carries the email subject / slide title with the
  // customer name in it. Carry that text forward as entityContext so post-
  // processing can attribute later sentences to the right customer.
  const header = sentences[0];

  return sentences.map((s, i) => ({
    text: s,
    sourceRef: `${chunk.sourceRef}#s${i}`,
    observedAt: chunk.observedAt,
    sourceExcerpt: s.slice(0, 240),
    defaultEntity: chunk.defaultEntity,
    entityContext: i === 0 ? chunk.entityContext : `${header} ${chunk.entityContext ?? ''}`,
  }));
}

function clip(s: string, max: number): string {
  const o = oneLine(s);
  return o.length <= max ? o : o.slice(0, max - 1) + '…';
}

async function callPioneer(body: PioneerRequest): Promise<PioneerResponse> {
  const url = `${PIONEER_BASE_URL.replace(/\/$/, '')}${PIONEER_PATH}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': getApiKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PioneerError(
        `Pioneer ${res.status}: ${text.slice(0, 240)}`,
        res.status,
        text,
      );
    }
    return (await res.json()) as PioneerResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function getApiKey(): string {
  const key = process.env.PIONEER_API_KEY;
  if (!key) throw new PioneerError('PIONEER_API_KEY not set');
  return key;
}
