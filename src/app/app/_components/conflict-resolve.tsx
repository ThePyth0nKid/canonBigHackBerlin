'use client';

import { useState, useTransition } from 'react';
import type { FactRow } from '@/lib/canon/view';
import { SourcePill } from './source-pill';
import { resolveConflict } from '../_actions/resolve';

interface Props {
  entity: string;
  metricKey: string;
  competing: FactRow[];
}

/**
 * Conflict-resolution modal. Lays competing claims as a side-by-side grid
 * (1 column on mobile) so the contradiction is obvious from the back of the
 * pitch room. Picking a winner triggers resolveConflict, which spawns the
 * canon-signer and persists a signed ResolutionEvent at the chain tip.
 */
export function ConflictResolve({ entity, metricKey, competing }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);

  if (competing.length < 2) return null;

  // Cluster competing facts by metric value so multiple sources for the same
  // value land in the same column. Latest + biggest cluster first. Cap at top
  // 3 visible columns — beyond that the modal gets unreadable on stage; the
  // tail-end clusters remain accessible from "view proof" on individual rows.
  const allClusters = clusterByValue(competing);
  const clusters = allClusters.slice(0, 3);
  const overflow = allClusters.length - clusters.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-600/60 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
      >
        <span aria-hidden>⚠</span>
        Resolve conflict
        <span aria-hidden className="opacity-60">→</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 py-12 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-wide text-zinc-500">
                  resolve conflict · {entity}.{metricKey}
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {allClusters.length} competing claims · pick the source of truth.
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Your pick gets signed with the same Ed25519 key as the
                  facts and chained on the audit log. Losing claims stay in
                  history as <span className="font-mono text-xs">superseded</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-2xl leading-none text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                ×
              </button>
            </div>

            <div
              className={`mt-6 grid gap-4 ${
                clusters.length === 2
                  ? 'sm:grid-cols-2'
                  : 'sm:grid-cols-2 md:grid-cols-3'
              }`}
            >
              {clusters.map((c) => {
                /* one column per value cluster — top 3 only */
                const head = c[0];
                const sources = [...new Set(c.map((f) => sourceKindOf(f.sourceRef)))];
                const latest = c.reduce<Date | null>((acc, f) => {
                  if (!f.observedAt) return acc;
                  return !acc || f.observedAt.getTime() > acc.getTime()
                    ? f.observedAt
                    : acc;
                }, null);
                return (
                  <div
                    key={head.id}
                    className="flex flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-semibold tabular-nums">
                        {head.metricValue ?? '—'}
                      </span>
                      {head.metricUnit && (
                        <span className="text-sm text-zinc-500">{head.metricUnit}</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {sources.map((s) => (
                        <SourcePill key={s} kind={s} />
                      ))}
                      <span className="font-mono text-[10px] text-zinc-500">
                        · {c.length} fact{c.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {latest && (
                      <p className="mt-1 font-mono text-[10px] text-zinc-500">
                        latest observed {latest.toISOString().slice(0, 10)}
                      </p>
                    )}
                    <p className="mt-3 line-clamp-3 text-xs text-zinc-700 dark:text-zinc-300">
                      “{head.sourceExcerpt ?? head.claim}”
                    </p>
                    <p className="mt-2 font-mono text-[10px] text-zinc-500 break-all">
                      {head.sourceRef}
                    </p>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setPicked(head.id);
                        start(async () => {
                          try {
                            await resolveConflict({
                              entity,
                              metricKey,
                              winnerFactId: head.id,
                            });
                            setOpen(false);
                          } catch (e) {
                            // Surface the failure inline so the button never
                            // gets stuck on "signing…" mid-pitch.
                            setPicked(null);
                            console.error('[conflict-resolve]', e);
                          }
                        });
                      }}
                      className="mt-4 inline-flex h-9 items-center justify-center rounded-full bg-zinc-950 px-4 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      {pending && picked === head.id ? 'signing…' : 'Sign as canonical'}
                    </button>
                  </div>
                );
              })}
            </div>
            {overflow > 0 && (
              <p className="mt-4 font-mono text-[11px] text-zinc-500">
                + {overflow} weitere kleinere Cluster · audit-history bleibt
                via{' '}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  view proof
                </span>{' '}
                auf einzelnen Facts.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function clusterByValue(facts: FactRow[]): FactRow[][] {
  const map = new Map<string, FactRow[]>();
  for (const f of facts) {
    const k = normalizeValue(f.metricValue ?? '');
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(f);
  }
  return [...map.values()].sort((a, b) => {
    const ta = a[0].observedAt?.getTime() ?? 0;
    const tb = b[0].observedAt?.getTime() ?? 0;
    if (tb !== ta) return tb - ta;
    return b.length - a.length;
  });
}

function normalizeValue(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s,€$£¥]/g, '')
    .replace(/k\b/, '000')
    .replace(/m\b/, '000000')
    .trim();
}

function sourceKindOf(sourceRef: string): string {
  return sourceRef.split(':', 1)[0];
}
