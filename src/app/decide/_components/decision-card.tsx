'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  askSourceAuthorsAction,
  escalateAction,
  escalateDirectlyAction,
  resolveByAuthorityAction,
} from '../_actions/decide-actions';
import { resolveConflict } from '@/app/app/_actions/resolve';
import { StepTracker, StageBadge } from './step-tracker';
import type { DecisionCard as Card } from '@/lib/canon/decide-view';
import type { FactRow } from '@/lib/canon/view';

interface Props {
  card: Card;
  /** Email of the signed-in user — recorded on the resolution event. */
  viewerEmail: string;
  /** True when the card was opened via a verified magic-link. Auto-expands
   *  details, highlights the border, and shows "your assigned conflict" copy. */
  focusedFromMagicLink?: boolean;
}

function sourceKindOf(sourceRef: string): string {
  return sourceRef.split(':')[0] || 'unknown';
}

function shortRef(sourceRef: string, max = 64): string {
  const noSuffix = sourceRef.replace(/#u=[^#]+/g, '').replace(/#from=[^#]+/g, '');
  return noSuffix.length > max ? noSuffix.slice(0, max) + '…' : noSuffix;
}

function relativeTime(d: Date | string | null): string {
  if (!d) return '';
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function authorOf(sourceRef: string): string | null {
  const u = sourceRef.match(/#u=([^#]+)/)?.[1];
  if (u) return `@${u.split('@')[0]}`;
  const f = sourceRef.match(/#from=([^#]+)/)?.[1];
  if (f) return f;
  return null;
}

export function DecisionCard({ card, viewerEmail, focusedFromMagicLink = false }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(focusedFromMagicLink);
  // Server actions call revalidatePath('/decide'), but with onClick + useTransition
  // (vs <form action>) the App Router doesn't auto-refetch the server component.
  // We call router.refresh() explicitly so the just-resolved card disappears
  // and the inbox count updates without a manual reload.
  const router = useRouter();
  const stage = card.thread?.stage ?? 'fresh';
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
      else router.refresh();
    });
  }

  function onEscalateThread() {
    if (!card.thread?.threadId) return;
    setError(null);
    startTransition(async () => {
      const r = await escalateAction({ threadId: card.thread!.threadId });
      if (!r.ok) setError(r.reason ?? 'escalate failed');
      else router.refresh();
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
      else router.refresh();
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
      else router.refresh();
    });
  }

  function onDecideDirect(winnerFactId: string) {
    setError(null);
    startTransition(async () => {
      const r = await resolveConflict({
        mode: 'canonical',
        entity: card.entity,
        metricKey: card.metricKey,
        winnerFactId,
      });
      if (!r.ok) setError('decide failed');
      else router.refresh();
    });
  }

  const candidatesByValue = new Map<string, FactRow[]>();
  for (const c of card.candidates) {
    const k = (c.metricValue ?? '?').trim();
    if (!candidatesByValue.has(k)) candidatesByValue.set(k, []);
    candidatesByValue.get(k)!.push(c);
  }

  const noAuthors = card.authorAvailability === 'none';
  const partialAuthors = card.authorAvailability === 'partial';
  const showAuthorityPickUI = stage === 'escalated';
  // Direct-decide bypasses the escalation thread. Hide it when the card
  // is already in an escalation chain — there, the right button is
  // "Pick as authority" so the resolution stays linked to the thread.
  // Showing both creates a confusing two-button choice for the same
  // outcome ("warum sind da jetzt zwei Optionen?").
  const directDecideAvailable = stage !== 'resolved' && stage !== 'escalated';

  return (
    <article
      className={`rounded-xl border bg-white p-5 shadow-sm dark:bg-zinc-950 ${
        focusedFromMagicLink
          ? 'border-2 border-sky-400 shadow-md dark:border-sky-600'
          : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {card.entityDisplay}
          </h3>
          <p className="font-mono text-[11px] text-zinc-500">
            {card.entity}.{card.metricKey}
          </p>
          {focusedFromMagicLink && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-sky-600 dark:text-sky-400">
              your assigned conflict
            </p>
          )}
        </div>
        <StageBadge stage={stage} />
      </header>

      <StepTracker stage={stage} skipAsk={noAuthors} />

      <div className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Competing claims ({candidatesByValue.size} distinct values · {card.candidates.length} fact{card.candidates.length === 1 ? '' : 's'})
          </p>
          <button
            type="button"
            onClick={() => setShowDetails((s) => !s)}
            className="rounded-md border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300"
          >
            {showDetails ? '− less info' : '+ more info'}
          </button>
        </div>
        <ul className="space-y-2">
          {[...candidatesByValue.entries()].map(([value, facts]) => {
            const sources = [...new Set(facts.map((f) => sourceKindOf(f.sourceRef)))];
            const authors = [...new Set(facts.map((f) => authorOf(f.sourceRef)).filter(Boolean) as string[])];
            const newest = facts.reduce<Date | null>((acc, f) => {
              const d = f.observedAt ?? f.signedAt;
              if (!d) return acc;
              return acc && acc > new Date(d) ? acc : new Date(d);
            }, null);
            return (
              <li
                key={value}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {value}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {facts.length} fact{facts.length === 1 ? '' : 's'} · {sources.join(' · ')}
                      {authors.length > 0 ? ` · ${authors.join(', ')}` : ''}
                      {newest ? ` · ${relativeTime(newest)}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {showAuthorityPickUI && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onAuthorityPick(facts[0].id)}
                        className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-rose-500 disabled:opacity-50"
                      >
                        Pick as authority
                      </button>
                    )}
                    {directDecideAvailable && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onDecideDirect(facts[0].id)}
                        title="Sign this value as canonical right now (no ask/escalate cycle)."
                        className="rounded-md border border-emerald-500 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500 hover:text-white disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      >
                        Decide
                      </button>
                    )}
                  </div>
                </div>
                {showDetails && (
                  <ul className="mt-2 space-y-2.5 border-t border-zinc-200 pt-2.5 dark:border-zinc-800">
                    {facts.map((f) => {
                      const author = authorOf(f.sourceRef);
                      const kind = sourceKindOf(f.sourceRef);
                      return (
                        <li key={f.id} className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          <div className="mb-1 flex flex-wrap items-baseline gap-1.5">
                            <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                              {kind}
                            </span>
                            {author && (
                              <span className="font-mono text-[10px] text-zinc-700 dark:text-zinc-300">
                                {author}
                              </span>
                            )}
                            {f.observedAt && (
                              <span className="text-[10px] text-zinc-500">
                                · {relativeTime(f.observedAt)}
                              </span>
                            )}
                          </div>
                          <p className="leading-relaxed text-zinc-700 dark:text-zinc-300">
                            “{f.sourceExcerpt ?? f.claim}”
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                            ref: {shortRef(f.sourceRef, 80)}
                            {' · '}
                            <span className="text-zinc-400">id: {f.id.slice(0, 14)}…</span>
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
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
            {' · '}
            <a
              href={`/app?focus=${encodeURIComponent(card.entity)}#entity-${card.entity}`}
              className="text-sky-600 hover:underline dark:text-sky-400"
            >
              full ledger →
            </a>
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
              {pending ? 'Escalating…' : `Escalate to ${card.escalationRole}`}
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
