'use client';

/**
 * Pages through the long tail of entities one chunk at a time.
 *
 * Receives the FULL ordered slug list from the server (cheap — strings
 * only, ~50KB even for 2200 entities) but renders nothing until the
 * user clicks "Show more". Each click invokes the loadEntityChunk
 * Server Action for the next 25 slugs, appends the returned
 * EntityGroup[] to local state, and re-renders with EntitySection.
 */

import { useState, useTransition } from 'react';
import type { EntityGroup } from '@/lib/canon/view';
import { loadEntityChunk } from '../_actions/load-tail';
import { EntitySection } from './entity-section';

const PAGE_SIZE = 25;

export function TailLoader({
  workspace,
  tailSlugs,
}: {
  workspace: string;
  tailSlugs: string[];
}) {
  const [loaded, setLoaded] = useState<EntityGroup[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = tailSlugs.length;
  const shown = loaded.length;
  const remaining = Math.max(0, total - shown);
  if (total === 0) return null;

  function loadMore(count: number) {
    setError(null);
    const next = tailSlugs.slice(shown, shown + count);
    startTransition(async () => {
      try {
        const chunk = await loadEntityChunk(workspace, next);
        setLoaded((prev) => [...prev, ...chunk]);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="mt-12 border-t border-zinc-200 pt-6 dark:border-zinc-900">
      {shown > 0 && (
        <div className="space-y-12">
          {loaded.map((e) => (
            <EntitySection key={e.slug} entity={e} />
          ))}
        </div>
      )}

      {remaining > 0 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => loadMore(PAGE_SIZE)}
            disabled={pending}
            className="rounded-full border border-zinc-300 bg-white px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
          >
            {pending
              ? 'Loading…'
              : shown === 0
                ? `Show ${Math.min(PAGE_SIZE, remaining)} more entities (${total} hidden)`
                : `Show ${Math.min(PAGE_SIZE, remaining)} more · ${remaining} remaining`}
          </button>
          {remaining > PAGE_SIZE && (
            <button
              type="button"
              onClick={() => loadMore(remaining)}
              disabled={pending}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 underline-offset-2 hover:text-zinc-700 hover:underline disabled:opacity-60 dark:hover:text-zinc-200"
            >
              Show all {remaining} remaining (slow)
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-center font-mono text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
