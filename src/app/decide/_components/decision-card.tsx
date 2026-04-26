'use client';

import { useState, useTransition } from 'react';
import {
  askSourceAuthorsAction,
  escalateAction,
  escalateDirectlyAction,
  resolveByAuthorityAction,
} from '../_actions/decide-actions';
import { StepTracker, StageBadge } from './step-tracker';
import type { DecisionCard as Card } from '@/lib/canon/decide-view';

interface Props {
  card: Card;
  /** Email of the signed-in user — recorded on the resolution event. */
  viewerEmail: string;
}

function sourceKindOf(sourceRef: string): string {
  return sourceRef.split(':')[0] || 'unknown';
}

export function DecisionCard({ card, viewerEmail }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const stage = card.thread?.stage ?? 'fresh';
  // V1: workspace owner can act as any authority. Audit trail still records
  // the logical role. Real per-role auth is V2.
  void viewerEmail;

  function onAsk() {
    setError(null);
    startTransition(async () => {
      const r = await askSourceAuthorsAction({
        entity: card.entity,
        metricKey: card.metricKey,
        conflictFactIds: card.candidates.map((c) => c.id),
      });
      if (!r.ok) setError(r.reason ?? 'ask failed');
    });
  }

  function onEscalateThread() {
    if (!card.thread?.threadId) return;
    setError(null);
    startTransition(async () => {
      const r = await escalateAction({ threadId: card.thread!.threadId });
      if (!r.ok) setError(r.reason ?? 'escalate failed');
    });
  }

  function onEscalateDirect() {
    setError(null);
    startTransition(async () => {
      const r = await escalateDirectlyAction({
        entity: card.entity,
        metricKey: card.metricKey,
        conflictFactIds: card.candidates.map((c) => c.id),
      });
      if (!r.ok) setError(r.reason ?? 'escalate failed');
    });
  }

  function onAuthorityPick(winnerFactId: string) {
    if (!card.thread?.threadId) return;
    setError(null);
    startTransition(async () => {
      const r = await resolveByAuthorityAction({
        threadId: card.thread!.threadId,
        winnerFactId,
      });
      if (!r.ok) setError(r.reason ?? 'resolve failed');
    });
  }

  const candidatesByValue = new Map<string, typeof card.candidates>();
  for (const c of card.candidates) {
    const k = (c.metricValue ?? '?').trim();
    if (!candidatesByValue.has(k)) candidatesByValue.set(k, []);
    candidatesByValue.get(k)!.push(c);
  }

  const noAuthors = card.authorAvailability === 'none';
  const partialAuthors = card.authorAvailability === 'partial';
  const showPickUI = stage === 'escalated';

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {card.entityDisplay}
          </h3>
          <p className="font-mono text-[11px] text-zinc-500">
            {card.entity}.{card.metricKey}
          </p>
        </div>
        <StageBadge stage={stage} />
      </header>

      <StepTracker stage={stage} skipAsk={noAuthors} />

      <div className="mt-3 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Competing claims ({candidatesByValue.size} distinct values)
        </p>
        <ul className="space-y-1.5">
          {[...candidatesByValue.entries()].map(([value, facts]) => (
            <li
              key={value}
              className="flex items-baseline justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div>
                <span className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {value}
                </span>
                <span className="ml-2 text-[10px] text-zinc-500">
                  ({facts.length} fact{facts.length === 1 ? '' : 's'})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase text-zinc-500">
                  {[...new Set(facts.map((f) => sourceKindOf(f.sourceRef)))].join(' · ')}
                </span>
                {showPickUI && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onAuthorityPick(facts[0].id)}
                    className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-rose-500 disabled:opacity-50"
                  >
                    Pick {value}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {card.thread?.responses && card.thread.responses.length > 0 && (
        <div className="mt-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Author responses
          </p>
          <ul className="mt-1.5 space-y-1 text-[12px]">
            {card.thread.responses.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="font-mono text-zinc-600">{r.by}</span>
                <span className="text-zinc-400">→</span>
                <span className="text-zinc-700 dark:text-zinc-300">{r.choice}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.thread?.escalation && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12px] dark:border-rose-900 dark:bg-rose-950">
          Escalated to <strong>{card.thread.escalation.role}</strong> ·{' '}
          <span className="font-mono">{card.thread.escalation.authorityEmail}</span>
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] text-zinc-500">
            Routes to <span className="font-medium">{card.escalationRole}</span> ·{' '}
            <span className="font-mono">{card.authorityEmail}</span>
          </p>
          {noAuthors && stage === 'fresh' && (
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">
              automated sources only — no human author to ask
            </p>
          )}
          {partialAuthors && stage === 'fresh' && (
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">
              {card.authorCount} of {card.totalCandidates} sources have a human author
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {stage === 'fresh' && !noAuthors && (
            <button
              type="button"
              disabled={pending}
              onClick={onAsk}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-sky-500 disabled:opacity-50"
            >
              {pending
                ? 'Asking…'
                : partialAuthors
                  ? `Ask ${card.authorCount} author${card.authorCount === 1 ? '' : 's'}`
                  : 'Ask source-authors'}
            </button>
          )}
          {stage === 'fresh' && noAuthors && (
            <button
              type="button"
              disabled={pending}
              onClick={onEscalateDirect}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-50"
            >
              {pending ? 'Escalating…' : `Escalate directly to ${card.escalationRole}`}
            </button>
          )}
          {(stage === 'diverged' || stage === 'asked' || stage === 'partial_response') && (
            <button
              type="button"
              disabled={pending}
              onClick={onEscalateThread}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-50"
            >
              {pending ? 'Escalating…' : 'Escalate'}
            </button>
          )}
        </div>
      </footer>

      {error && (
        <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </article>
  );
}
