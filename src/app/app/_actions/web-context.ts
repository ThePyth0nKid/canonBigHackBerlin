'use server';

/**
 * Server action for the user-triggered "Search web for context →" button
 * in AskCanon answers. Wraps the cached + rate-limited Tavily lib so the
 * Tavily key never crosses the client/server boundary and so the demo
 * doesn't burn the day's API quota on rehearsals.
 */

import { auth } from '@/auth';
import {
  searchExternalCached,
  ExternalLookupError,
  type CachedExternalResult,
} from '@/lib/canon/web-context';
import { detectEntities } from '@/lib/canon/search';

export interface WebContextResult extends CachedExternalResult {
  /** The actual query Tavily received — may differ from the user's
   *  question because we append disambiguation hints when known entities
   *  appear (e.g. "Bright Plc" → "Bright Plc company"). UI surfaces this
   *  so the audience sees we're not pretending Tavily is magic. */
  effectiveQuery: string;
  /** Was the query rewritten by us before being sent to Tavily? */
  wasEnhanced: boolean;
}

export async function searchWebContextAction(args: {
  query: string;
}): Promise<WebContextResult | { error: string; code?: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return { error: 'Sign in to search the web for context.' };
  }

  // Disambiguation: when the question names a known business entity
  // (Miller Group, Bright Plc, Gonzalez Inc…), append "company" to bias
  // Tavily toward business results. Without this, "Bright Plc" gets
  // ranked against "PLC = Programmable Logic Controller" hits because
  // Tavily can't tell which is meant. Adding "company" doesn't change
  // the trust gradient — every result still arrives with unsigned: true.
  const detected = await detectEntities(userId, 'inazuma', args.query);
  const wasEnhanced = detected.length > 0;
  const effectiveQuery = wasEnhanced ? `${args.query} company` : args.query;

  try {
    const res = await searchExternalCached(effectiveQuery, {
      userId,
      maxResults: 5,
    });
    return { ...res, effectiveQuery, wasEnhanced };
  } catch (e) {
    if (e instanceof ExternalLookupError) {
      return { error: e.message, code: e.code };
    }
    console.error('[searchWebContextAction] unexpected', e);
    return {
      error: `Web search failed: ${(e as Error).message ?? 'unknown'}`,
    };
  }
}
