'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordResponseAction } from '../_actions/decide-actions';
import type { AuthorAsk } from '@/lib/canon/decide-view';

interface Props {
  asks: AuthorAsk[];
  viewerEmail: string;
  /** When set (via verified magic-link), lock the panel to this addressee. */
  prefilledRespondingAs?: string | null;
  /** When set, the matching ask is shown alone, scrolled to top. */
  focusThreadId?: string | null;
}

/**
 * Renders pending source-author asks. Two modes:
 *
 *  1. **Free mode** (default): each ask renders one row per addressee
 *     with a "Respond as <addressee>" button group. The workspace owner
 *     picks which logical persona to answer as.
 *
 *  2. **Locked mode** (when `prefilledRespondingAs` is set via a verified
 *     magic-link): the panel filters to the focused thread and shows
 *     only the candidate buttons attributed to that one addressee.
 *     Other personas hidden — the email recipient already declared who
 *     they are by clicking their own link.
 *
 * The audit trail records the logical addressee (`notes.by=<email>`)
 * regardless of mode. Session identity is the workspace owner; per-role
 * authentication is V2.
 */
export function AuthorResponsePanel({
  asks,
  viewerEmail,
  prefilledRespondingAs,
  focusThreadId,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // revalidatePath('/decide') runs server-side; router.refresh() makes the
  // client refetch the server component so the answered ask disappears.
  const router = useRouter();

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
      else router.refresh();
    });
  }

  // Locked-mode filtering: if a magic-link was verified, scope to the
  // focused thread and the verified persona — but only if that thread
  // is still open. If the thread is gone (settled, or stale smoke-test
  // token), gracefully degrade to free mode so the user still sees
  // their other open asks instead of a dead-end "settled" screen.
  const matchedAsks =
    prefilledRespondingAs && focusThreadId
      ? asks.filter((a) => a.threadId === focusThreadId)
      : [];
  const locked = matchedAsks.length > 0;
  const visibleAsks = locked ? matchedAsks : asks;
  const staleMagicLink = Boolean(prefilledRespondingAs) && matchedAsks.length === 0;

  if (visibleAsks.length === 0) {
    if (staleMagicLink) {
      return (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            That magic-link points to a thread that's already settled (or never existed).
            No open questions are waiting for you right now.
          </p>
        </section>
      );
    }
    return null;
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {locked
            ? 'Confirm your claim'
            : `Questions for source-authors (${visibleAsks.length})`}
        </h2>
        <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400">
          {locked
            ? `acting as ${prefilledRespondingAs}`
            : prefilledRespondingAs
              ? `magic-link verified as ${prefilledRespondingAs}`
              : `signed in as ${viewerEmail}`}
        </span>
      </header>

      <ul className="space-y-3">
        {visibleAsks.map((ask) => {
          // In locked mode: only render the addressee row for the verified
          // persona. In free mode: render every addressee row as before.
          const addresseesToShow = locked
            ? ask.addressees.filter(
                (a) => a.id.toLowerCase() === prefilledRespondingAs?.toLowerCase(),
              )
            : ask.addressees;

          return (
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

              {addresseesToShow.map((addressee) => (
                <div key={addressee.id} className="mt-2 space-y-1">
                  {!locked && (
                    <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Respond as{' '}
                      {addressee.kind === 'gmail'
                        ? addressee.id
                        : `slack:${addressee.id}`}
                    </p>
                  )}
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
                        className={`mr-2 inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
                          locked && isMine
                            ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm hover:bg-emerald-600'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-emerald-950'
                        }`}
                      >
                        <span className="font-mono">{c.value ?? '?'}</span>
                        <span className={`text-[10px] ${locked && isMine ? 'text-emerald-100' : 'text-zinc-500'}`}>
                          {c.sourceKind}
                          {isMine ? (locked ? ' · yours' : ' (mine)') : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </section>
  );
}
