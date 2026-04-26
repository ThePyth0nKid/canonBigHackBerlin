'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { coSignResolution } from '../_actions/cosign-resolution';
import type { PendingResolution } from '@/lib/canon/pending-view';

/**
 * Live tracking surface for high-risk picks awaiting 4-eyes co-signature.
 *
 * Mounted on /app above AskCanon. Reads workspace-scoped (NOT user-
 * scoped) so a second admin signed in with a different OAuth identity
 * can see + co-sign the initiator's pending pick.
 *
 * Each row's affordance depends on viewer identity:
 *   - viewer.email === initiator.email → "Awaiting different admin"
 *     (the system refuses self-cosign — same rule the server enforces).
 *   - viewer.email !== initiator.email → green "Co-sign · admin" button.
 *
 * Click → coSignResolution(resolutionFactId) → atomic flip
 * (status='resolution', losers superseded, cosign event signed) →
 * router.refresh() so the row vanishes from this panel and the
 * AskCanon conflict count drops in lock-step.
 */
export interface PendingResolutionsPanelProps {
  pending: PendingResolution[];
  viewerEmail: string;
  /**
   * Set by the magic-link landing handler when the viewer arrived via
   * email. The matching row gets a violet ring + auto-scroll so the
   * cosigner doesn't have to find it.
   */
  focusResolutionFactId?: string | null;
}

export function PendingResolutionsPanel({
  pending,
  viewerEmail,
  focusResolutionFactId,
}: PendingResolutionsPanelProps) {
  if (pending.length === 0) return null;
  return (
    <section
      aria-label="Resolutions awaiting 4-eyes co-sign"
      className="mb-5 rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm dark:border-violet-700/50 dark:from-violet-950/30 dark:to-zinc-950"
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base">👁️👁️</span>
          <h2 className="text-sm font-semibold text-violet-900 dark:text-violet-100">
            {pending.length} resolution{pending.length === 1 ? '' : 's'} awaiting 4-eyes co-sign
          </h2>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300">
          high-risk · pending on chain
        </p>
      </header>
      <p className="mb-3 text-[12px] leading-relaxed text-violet-900/80 dark:text-violet-100/80">
        High-risk metric picks (ARR, MRR, contract value, …) need a second admin
        to co-sign before the supersedure applies. Each row is already a signed
        FactEvent on the chain — even if no one ever co-signs, the proposal
        leaves a permanent audit trace.
      </p>
      <ol className="space-y-2">
        {pending.map((p) => (
          <PendingRow
            key={p.resolutionFactId}
            row={p}
            viewerEmail={viewerEmail}
            focused={p.resolutionFactId === focusResolutionFactId}
          />
        ))}
      </ol>
    </section>
  );
}

function PendingRow({
  row,
  viewerEmail,
  focused,
}: {
  row: PendingResolution;
  viewerEmail: string;
  focused: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ supersededNow: number; cosignerEmail: string } | null>(null);

  const isInitiator =
    !!viewerEmail && viewerEmail.toLowerCase() === row.initiatorEmail.toLowerCase();

  function submit() {
    setError(null);
    start(async () => {
      try {
        const r = await coSignResolution({ resolutionFactId: row.resolutionFactId });
        if (!r.ok) {
          setError(
            r.error === 'admin-required'
              ? 'Admin role required to co-sign.'
              : r.error === 'same-as-initiator'
                ? 'Co-sign refused — same email as the initiator. A SECOND admin must sign.'
                : r.error,
          );
          return;
        }
        setDone({ supersededNow: r.superseded, cosignerEmail: r.cosignerEmail });
        // Give the audience 800ms to see the green confirmation, then refresh
        // so the row falls off the panel and AskCanon's conflict count drops.
        setTimeout(() => router.refresh(), 800);
      } catch (e) {
        setError((e as Error).message ?? 'Co-sign failed');
      }
    });
  }

  return (
    <li
      id={`pending-${row.resolutionFactId}`}
      className={`scroll-mt-24 rounded-xl border bg-white p-3 shadow-sm transition-all dark:bg-zinc-950 ${
        focused
          ? 'border-2 border-violet-500 ring-2 ring-violet-300 dark:border-violet-400 dark:ring-violet-700/50'
          : 'border-violet-200 dark:border-violet-800/40'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300">
            {row.entityDisplay} · {row.metricKey}
          </p>
          <p className="mt-0.5 break-all text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {row.metricValue ?? '—'}
            {row.metricUnit && (
              <span className="ml-1 text-xs font-normal text-zinc-500">{row.metricUnit}</span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
            Proposed by{' '}
            <span className="font-mono text-zinc-800 dark:text-zinc-200">
              {row.initiatorEmail}
            </span>
            {isInitiator && (
              <span className="ml-1 rounded-full bg-zinc-200 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                you
              </span>
            )}
            {' · '}
            {relTime(row.signedAt)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {row.willSupersedeCount} fact{row.willSupersedeCount === 1 ? '' : 's'} will flip to
            superseded once co-signed · pending event{' '}
            <span className="font-mono text-zinc-700 dark:text-zinc-300">
              {row.resolutionFactId.slice(0, 14)}…
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {done ? (
            <span className="inline-flex h-8 items-center justify-center rounded-full bg-emerald-600 px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-white dark:bg-emerald-500">
              ✓ co-signed by {done.cosignerEmail.split('@')[0]} · {done.supersededNow} superseded
            </span>
          ) : isInitiator ? (
            <span
              className="inline-flex h-8 items-center justify-center rounded-full border border-zinc-300 bg-zinc-100 px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              title="The 4-eyes principle prevents self-cosign. A different admin must sign."
            >
              awaiting different admin
            </span>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="inline-flex h-8 items-center justify-center rounded-full bg-violet-700 px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm hover:bg-violet-800 disabled:bg-violet-400 dark:bg-violet-600 dark:hover:bg-violet-700"
            >
              {pending ? 'co-signing…' : 'co-sign · admin'}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-2 font-mono text-[10px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </li>
  );
}

function relTime(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
