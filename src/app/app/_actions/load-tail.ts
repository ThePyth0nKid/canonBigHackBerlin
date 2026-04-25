'use server';

/**
 * Lazy entity-page loader. The page surface ships with featured entities
 * server-rendered; the long tail (~2200 entities for Inazuma) comes
 * through this action one chunk at a time. Avoids the 11MB initial
 * payload the wholesale loader had.
 */

import { auth } from '@/auth';
import { loadEntitiesBySlugs, type EntityGroup } from '@/lib/canon/view';

export async function loadEntityChunk(
  workspace: string,
  slugs: string[],
): Promise<EntityGroup[]> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return [];
  if (!Array.isArray(slugs) || slugs.length === 0) return [];
  // Hard cap protects the server: even if the client requests N, never
  // fetch more than 100 entities per round-trip.
  const safeSlugs = slugs.slice(0, 100);
  return loadEntitiesBySlugs(userId, workspace, safeSlugs);
}
