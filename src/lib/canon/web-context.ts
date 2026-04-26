/**
 * Tavily web-context wrapper — adds a small in-memory cache and a per-user
 * rate limit on top of `searchExternal()` so the user-triggered "search web
 * for context →" button in AskCanon answers can hit Tavily without burning
 * the API on demo-day rehearsals.
 *
 * Caching: 5-minute TTL keyed by query string, module-scoped Map (single
 * Next process). Demo-grade; sufficient for the pitch since the same 3-5
 * queries are hit repeatedly and stay warm.
 *
 * Architectural invariant: every item still carries `unsigned: true` from
 * tavily.ts — this wrapper only changes when the call is made, not what
 * the call returns.
 */

import { searchExternal, type ExternalContextResult } from './tavily';

export type { ExternalContextResult };

const CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_PER_USER_PER_MIN = 12;
const cache = new Map<string, { result: ExternalContextResult; expiresAt: number }>();
const userLastCalls = new Map<string, number[]>();

export interface CachedExternalResult extends ExternalContextResult {
  cached: boolean;
}

export interface ExternalLookupOpts {
  userId?: string;
  searchDepth?: 'basic' | 'advanced';
  topic?: 'general' | 'news' | 'finance';
  maxResults?: number;
}

export class ExternalLookupError extends Error {
  constructor(
    message: string,
    readonly code: 'rate_limited' | 'tavily_error' | 'invalid_query',
  ) {
    super(message);
    this.name = 'ExternalLookupError';
  }
}

export async function searchExternalCached(
  query: string,
  opts: ExternalLookupOpts = {},
): Promise<CachedExternalResult> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed.length > 240) {
    throw new ExternalLookupError(
      'Query must be 2..240 characters.',
      'invalid_query',
    );
  }

  if (opts.userId) {
    const now = Date.now();
    const recent = (userLastCalls.get(opts.userId) ?? []).filter(
      (t) => now - t < 60_000,
    );
    if (recent.length >= RATE_LIMIT_PER_USER_PER_MIN) {
      throw new ExternalLookupError(
        `Rate limited (${RATE_LIMIT_PER_USER_PER_MIN} web lookups per minute).`,
        'rate_limited',
      );
    }
    recent.push(now);
    userLastCalls.set(opts.userId, recent);
  }

  const now = Date.now();
  const cacheKey = `${trimmed}|${opts.searchDepth ?? 'basic'}|${opts.topic ?? 'general'}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return { ...hit.result, cached: true };
  }

  let result: ExternalContextResult;
  try {
    result = await searchExternal(trimmed, {
      maxResults: opts.maxResults ?? 5,
      searchDepth: opts.searchDepth ?? 'basic',
      topic: opts.topic,
    });
  } catch (e) {
    throw new ExternalLookupError(
      (e as Error).message ?? 'Tavily error',
      'tavily_error',
    );
  }

  cache.set(cacheKey, { result, expiresAt: now + CACHE_TTL_MS });
  return { ...result, cached: false };
}
