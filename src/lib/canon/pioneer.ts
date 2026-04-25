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
}

/**
 * Run Pioneer over a batch of pre-chunked text and return FactDrafts.
 * Each chunk produces 0 or 1 drafts: 1 if Pioneer found a known canonical
 * entity, 0 otherwise (drift / noise gets filtered).
 */
export async function extractFactsFromChunks(
  chunks: Chunk[],
  opts?: { threshold?: number },
): Promise<FactDraft[]> {
  const filtered = chunks.filter((c) => c.text.trim().length > 0);
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
      const draft = blockToDraft(blocks[idx], chunk);
      if (draft) drafts.push(draft);
    });
  }
  return drafts;
}

function blockToDraft(block: RawResultBlock | undefined, chunk: Chunk): FactDraft | null {
  const row = block?.fact?.[0];
  const metricKey = (row?.metric_key ?? '').toString().trim();
  const metricValue = (row?.metric_value ?? '').toString().trim();
  const metricUnit = (row?.metric_unit ?? '').toString().trim() || undefined;
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
