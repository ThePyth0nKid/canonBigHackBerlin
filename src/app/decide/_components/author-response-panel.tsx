'use client';

import { useState, useTransition } from 'react';
import { recordResponseAction } from '../_actions/decide-actions';
import type { AuthorAsk } from '@/lib/canon/decide-view';

interface Props {
  asks: AuthorAsk[];
  viewerEmail: string;
}

/**
 * Renders pending source-author asks. Each ask gets one row per addressee
 * with a "Respond as <addressee>" group of buttons. In V1 the workspace
 * owner can answer for any addressee — the audit trail records *which*
 * logical addressee answered (regardless of session). Real per-addressee
 * auth is V2.
 */
export function AuthorResponsePanel({ asks, viewerEmail }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onPick(args: {
    threadId: string;
    factId: string;
    respondingAs: string;
    isMine: boolean;
  }) {
    setError(null);
    startTransition(async () => {
      const r = await recordResponseAction({
        threadId: args.threadId,
        choice: args.isMine ? 'mine_stands' : 'theirs_stands',
        chosenFactId: args.factId,
        respondingAs: args.respondingAs,
      });
      if (!r.ok) setError(r.reason ?? 'response failed');
    });
  }

  if (asks.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Questions for source-authors ({asks.length})
        </h2>
        <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400">
          signed in as {viewerEmail}
        </span>
      </header>

      <ul className="space-y-3">
        {asks.map((ask) => (
          <li
            key={ask.threadId}
            className="rounded-lg border border-amber-300 bg-white p-3 dark:border-amber-800 dark:bg-zinc-950"
          >
            <p className="text-[12px] text-zinc-700 dark:text-zinc-300">
              <span className="font-mono">
                {ask.entity}.{ask.metricKey}
              </span>{' '}
              — competing claims:
            </p>

            {ask.addressees.map((addressee) => (
              <div key={addressee.id} className="mt-2 space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Respond as {addressee.kind === 'gmail' ? addressee.id : `slack:${addressee.id}`}
                </p>
                {ask.candidates.map((c) => {
                  // "Mine" = the candidate fact whose own sourceRef matches
                  // this addressee's identity. Approximation: same source-kind.
                  const isMine = c.sourceKind === addressee.kind;
                  return (
                    <button
                      key={`${addressee.id}::${c.factId}`}
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        onPick({
                          threadId: ask.threadId,
                          factId: c.factId,
                          respondingAs: addressee.id,
                          isMine,
                        })
                      }
                      className="mr-2 inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-emerald-950"
                    >
                      <span className="font-mono">{c.value ?? '?'}</span>
                      <span className="text-[10px] text-zinc-500">
                        {c.sourceKind}
                        {isMine ? ' (mine)' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </section>
  );
}
