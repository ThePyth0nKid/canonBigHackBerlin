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

export async function searchWebContextAction(args: {
  query: string;
}): Promise<CachedExternalResult | { error: string; code?: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return { error: 'Sign in to search the web for context.' };
  }
  try {
    return await searchExternalCached(args.query, { userId, maxResults: 5 });
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
