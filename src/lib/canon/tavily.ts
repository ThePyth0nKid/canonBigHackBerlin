/**
 * Tavily client — Layer 2.5 of the Trust Pipeline (external context).
 *
 * Canon emits *signed* facts for what's in your sources. Tavily returns
 * *unsigned* public-web context for the same entity. Both flow through
 * the MCP surface; agents (and the audit log) see exactly which facts
 * are cryptographically provable and which are best-effort web context.
 *
 * Design constraint: every Tavily-derived item carries `unsigned: true`
 * and a clear `source: 'tavily-web'` so it cannot be confused with a
 * Canon FactEvent. This is the architectural disambiguation that makes
 * Tavily a real Trust-Pipeline contribution rather than a sticker.
 *
 * Endpoint: POST https://api.tavily.com/search · Authorization: Bearer
 * Docs: https://docs.tavily.com/welcome
 */

const TAVILY_BASE_URL = process.env.TAVILY_BASE_URL ?? 'https://api.tavily.com';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface TavilySearchOpts {
  /** Max results to return. Tavily caps at 20. */
  maxResults?: number;
  /** Search depth — 'basic' is fast/cheap, 'advanced' digs deeper. */
  searchDepth?: 'basic' | 'advanced';
  /** Optional ISO date floor. Tavily honors date ranges via 'time_range'. */
  daysBack?: number;
  /** Restrict to a topic group. */
  topic?: 'general' | 'news' | 'finance';
  /** Comma-separated allowlist of domains, e.g. 'linkedin.com,crunchbase.com'. */
  includeDomains?: string[];
}

interface TavilyApiRequest {
  query: string;
  max_results?: number;
  search_depth?: 'basic' | 'advanced';
  days?: number;
  topic?: 'general' | 'news' | 'finance';
  include_domains?: string[];
  include_answer?: boolean;
}

interface TavilyApiResult {
  title: string;
  url: string;
  content: string;
  /** Tavily's relevance score 0..1. */
  score?: number;
  published_date?: string;
}

interface TavilyApiResponse {
  query: string;
  /** Tavily's optional one-paragraph synthesised answer. */
  answer?: string;
  results: TavilyApiResult[];
  /** Total elapsed time on Tavily's end. */
  response_time?: number;
}

export interface ExternalContextItem {
  /** Always true. The single architectural invariant the audit log relies on. */
  unsigned: true;
  /** Always 'tavily-web'. Identifies the provider in audit logs. */
  source: 'tavily-web';
  title: string;
  url: string;
  excerpt: string;
  /** 0..1 if Tavily provided one. */
  relevance?: number;
  publishedAt?: string;
}

export interface ExternalContextResult {
  query: string;
  /** Always tagged unsigned — every consumer must respect this. */
  items: ExternalContextItem[];
  /** Tavily's optional synthesised answer, kept for surfacing in MCP output. */
  synthesis?: string;
  fetchedAt: string;
  latencyMs: number;
}

export class TavilyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TavilyError';
  }
}

function getApiKey(): string {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw new TavilyError(
      'TAVILY_API_KEY not set — sign up at tavily.com to get a key',
    );
  }
  return key;
}

/**
 * Public-web search for an entity / query / keyword.
 * Always tags items as unsigned: true. Use this when the caller wants
 * external context that complements (never replaces) Canon's signed facts.
 */
export async function searchExternal(
  query: string,
  opts?: TavilySearchOpts,
): Promise<ExternalContextResult> {
  const t0 = Date.now();
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      query: '',
      items: [],
      fetchedAt: new Date().toISOString(),
      latencyMs: 0,
    };
  }

  const body: TavilyApiRequest = {
    query: trimmed,
    max_results: Math.min(opts?.maxResults ?? 5, 20),
    search_depth: opts?.searchDepth ?? 'basic',
    include_answer: true,
  };
  if (opts?.daysBack) body.days = opts.daysBack;
  if (opts?.topic) body.topic = opts.topic;
  if (opts?.includeDomains?.length) body.include_domains = opts.includeDomains;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  let resp: TavilyApiResponse;
  try {
    const res = await fetch(`${TAVILY_BASE_URL}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new TavilyError(
        `Tavily ${res.status}: ${text.slice(0, 240)}`,
        res.status,
      );
    }
    resp = (await res.json()) as TavilyApiResponse;
  } finally {
    clearTimeout(timer);
  }

  const items: ExternalContextItem[] = (resp.results ?? []).map((r) => ({
    unsigned: true,
    source: 'tavily-web',
    title: r.title,
    url: r.url,
    excerpt: clip(r.content ?? '', 280),
    relevance: r.score,
    publishedAt: r.published_date,
  }));

  return {
    query: trimmed,
    items,
    synthesis: resp.answer,
    fetchedAt: new Date().toISOString(),
    latencyMs: Date.now() - t0,
  };
}

function clip(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…';
}
