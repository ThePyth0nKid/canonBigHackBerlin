'use client';

/**
 * Ask-Canon inline fight card — one (entity, metricKey) decision the user
 * must sign off on. Rendered when `intent=conflict`. Replaces the old
 * tiny-square candidate grid that the user said was unscannable; the new
 * layout is a vertical "vs." stack with one candidate per row, large
 * tabular value on the left, source brand + excerpt in the middle, and
 * the primary "Sign canonical" CTA on the right.
 *
 * Decision-first: the card itself reads "1 / 8 · Miller Group · industry"
 * so the user knows where in the queue they are. >2 candidates fold to
 * top-2 + "+ N more" so an 8-candidate fight doesn't blow out the page.
 *
 * Wire-up unchanged: every action still fires the existing
 * `resolveConflict` server action with the same shape.
 */

import { useState, useTransition } from 'react';
import { resolveConflict } from '../_actions/resolve';
import type { ConflictCandidate, InlineConflict } from '@/lib/canon/ask';
import { BrandChip, brandFor } from './ask-source-brand';

type FightOutcome =
  | { kind: 'canonical'; winnerFactId: string; superseded: number; resolutionFactId: string }
  | { kind: 'distinct'; resolutionFactId: string };

const CANDIDATES_VISIBLE = 2;

export function AskFightCard({
  conflict,
  index,
  total,
}: {
  conflict: InlineConflict;
  index: number;
  total: number;
}) {
  const [outcome, setOutcome] = useState<FightOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const allFactIds = conflict.candidates.map((c) => c.factId);
  const visible = showAll
    ? conflict.candidates
    : conflict.candidates.slice(0, CANDIDATES_VISIBLE);
  const hidden = conflict.candidates.length - visible.length;

  function pickCanonical(winnerFactId: string) {
    setError(null);
    setPendingId(winnerFactId);
    start(async () => {
      try {
        const r = await resolveConflict({
          mode: 'canonical',
          entity: conflict.entity,
          metricKey: conflict.metricKey,
          winnerFactId,
        });
        if (!r.ok) {
          setError('Resolve refused — server returned ok=false');
          setPendingId(null);
          return;
        }
        setOutcome({
          kind: 'canonical',
          winnerFactId,
          superseded: r.superseded,
          resolutionFactId: r.resolutionFactId ?? '',
        });
        setPendingId(null);
      } catch (e) {
        setError((e as Error).message ?? 'Resolve failed');
        setPendingId(null);
      }
    });
  }

  function markDistinct() {
    setError(null);
    setPendingId('__distinct__');
    start(async () => {
      try {
        const r = await resolveConflict({
          mode: 'distinct',
          entity: conflict.entity,
          metricKey: conflict.metricKey,
          candidateFactIds: allFactIds,
        });
        if (!r.ok) {
          setError('Distinct refused — server returned ok=false');
          setPendingId(null);
          return;
        }
        setOutcome({
          kind: 'distinct',
          resolutionFactId: r.resolutionFactId ?? '',
        });
        setPendingId(null);
      } catch (e) {
        setError((e as Error).message ?? 'Distinct failed');
        setPendingId(null);
      }
    });
  }

  const winnerFactId = outcome?.kind === 'canonical' ? outcome.winnerFactId : null;
  const resolved = !!outcome;

  return (
    <article
      id={`fight-${conflict.entity}-${conflict.metricKey}`}
      className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-white shadow-sm transition-colors dark:bg-zinc-950 ${
        resolved
          ? 'border-emerald-300 dark:border-emerald-700/60'
          : 'border-amber-300 dark:border-amber-700/60'
      }`}
    >
      {/* HEADER — entity + metric + position in queue. Big enough that the
          user sees "what am I deciding here" before the candidates. */}
      <header
        className={`flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-3 ${
          resolved
            ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/30'
            : 'border-amber-200 bg-amber-50/60 dark:border-amber-800/50 dark:bg-amber-950/20'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p
            className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${
              resolved
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            Conflict {index} / {total} · {conflict.metricKey}
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {conflict.entityDisplay}
          </h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {conflict.candidates.length} competing values
        </span>
      </header>

      {/* CANDIDATES — vertical stack so each row is a complete unit the
          eye can read in one sweep. Top 2 by default; rest collapsed. */}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {visible.map((cand) => (
          <CandidateRow
            key={cand.factId}
            cand={cand}
            isWinner={winnerFactId === cand.factId}
            isLoser={!!winnerFactId && winnerFactId !== cand.factId}
            isPending={pending && pendingId === cand.factId}
            disabled={pending || resolved}
            onPick={() => pickCanonical(cand.factId)}
          />
        ))}
      </ul>

      {hidden > 0 && !showAll && !resolved && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="block w-full border-t border-zinc-100 bg-zinc-50 px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-900 dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          + {hidden} more candidate{hidden === 1 ? '' : 's'} · show
        </button>
      )}

      {/* FOOTER — secondary action (distinct) and outcome / error. Distinct
          intentionally tertiary because in 95% of cases the user wants to
          pick a winner; the modal flow handles the long tail. */}
      {!resolved && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-2 dark:border-zinc-900 dark:bg-zinc-900/30">
          <p className="font-mono text-[10px] text-zinc-500">
            None of these are wrong? Mark them as independent records.
          </p>
          <button
            type="button"
            onClick={markDistinct}
            disabled={pending}
            className="inline-flex h-7 items-center justify-center rounded-full border border-sky-400 bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-sky-800 transition-colors hover:bg-sky-50 disabled:opacity-60 dark:border-sky-600 dark:bg-zinc-950 dark:text-sky-200 dark:hover:bg-sky-950/60"
          >
            {pending && pendingId === '__distinct__'
              ? 'signing…'
              : 'Mark as distinct'}
          </button>
        </footer>
      )}

      {outcome && (
        <footer className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 font-mono text-[10px] text-emerald-900 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          <span className="font-semibold uppercase tracking-wider">signed</span>
          <span className="ml-2">
            {outcome.kind === 'canonical'
              ? `canonical · ${outcome.superseded} superseded`
              : 'distinct records · none superseded'}
          </span>
          {outcome.resolutionFactId && (
            <span className="ml-2 opacity-60">
              {outcome.resolutionFactId.slice(0, 18)}…
            </span>
          )}
        </footer>
      )}

      {error && (
        <p className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-[11px] text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}
    </article>
  );
}

function CandidateRow({
  cand,
  isWinner,
  isLoser,
  isPending,
  disabled,
  onPick,
}: {
  cand: ConflictCandidate;
  isWinner: boolean;
  isLoser: boolean;
  isPending: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const b = brandFor(cand.sourceRef);
  const tone = isWinner
    ? 'bg-emerald-50/60 dark:bg-emerald-950/30'
    : isLoser
      ? 'opacity-40'
      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40';
  return (
    <li className={`relative flex flex-wrap items-start gap-3 px-4 py-3 transition-colors ${tone}`}>
      {/* Brand-coloured left rail so each candidate has an immediate
          source identity even before the chip is read. */}
      <span
        aria-hidden
        className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${b.dotBg}`}
      />

      {/* VALUE — large, tabular, the load-bearing element on the row. */}
      <div className="ml-2 min-w-[7rem] flex-shrink-0">
        <p className="break-words text-2xl font-semibold tabular-nums leading-tight text-zinc-900 dark:text-zinc-50">
          {cand.value ?? '—'}
          {cand.unit && (
            <span className="ml-1 text-sm font-normal text-zinc-500">
              {cand.unit}
            </span>
          )}
        </p>
        <div className="mt-1.5">
          <BrandChip sourceRef={cand.sourceRef} />
        </div>
      </div>

      {/* EXCERPT + factId — supporting context, smaller. */}
      <div className="min-w-0 flex-1">
        {cand.sourceExcerpt ? (
          <p className="line-clamp-2 border-l-2 border-zinc-200 pl-2 text-xs italic leading-snug text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            “{cand.sourceExcerpt.replace(/\s+/g, ' ').trim()}”
          </p>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            no excerpt
          </p>
        )}
        <p className="mt-1 break-all font-mono text-[9px] text-zinc-400">
          {cand.factId}
        </p>
      </div>

      {/* CTA — visually dominant; the entire row's job. Hidden when a
          winner has already been chosen for this card. */}
      <div className="flex-shrink-0 self-center">
        {isWinner ? (
          <span className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-4 font-mono text-[11px] font-semibold uppercase tracking-wider text-white dark:bg-emerald-500">
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 8 L7 12 L13 4" />
            </svg>
            canonical
          </span>
        ) : (
          <button
            type="button"
            onClick={onPick}
            disabled={disabled}
            className="inline-flex h-9 items-center justify-center rounded-full bg-zinc-950 px-4 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            {isPending ? 'signing…' : 'Sign as canonical'}
          </button>
        )}
      </div>
    </li>
  );
}
