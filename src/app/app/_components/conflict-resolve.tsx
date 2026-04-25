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
 * Two outcomes the human can reach when staring at competing claims:
 *
 *   A. canonical — pick one as the source of truth. ResolutionEvent
 *      signed at chain tip; losers flipped to 'superseded'.
 *   B. distinct  — same entity slug, but the records describe
 *      INDEPENDENT real-world things (same business name with
 *      different client_ids; same metric at different points in time;
 *      etc). No supersedure; signed acknowledgement that a human
 *      reviewed and chose not to merge identity.
 *
 * Canon's job is to surface provenance and record the human's call.
 * It does NOT auto-merge identity by clobbering the loser.
 */
export function ConflictResolve({ entity, metricKey, competing }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);

  if (competing.length < 2) return null;

  // Cluster competing facts by metric value so multiple sources for the same
  // value land in the same column. Latest + biggest cluster first. Cap at top
  // 4 visible columns so the modal stays scannable.
  const allClusters = clusterByValue(competing);
  const clusters = allClusters.slice(0, 4);
  const overflow = allClusters.length - clusters.length;

  // For "distinct" mode we want every visible candidate's id, not just the
  // cluster heads — that way the signed event references all reviewed records.
  const allCandidateFactIds = clusters.flatMap((c) => c.map((f) => f.id));

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
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 py-12 backdrop-blur-md"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  resolve · {entity}.{metricKey}
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {allClusters.length} candidate values · resolve OR mark as distinct.
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Each candidate is a real signed FactEvent. Two paths: pick
                  one as <span className="font-mono text-xs">canonical</span>{' '}
                  (others flip to{' '}
                  <span className="font-mono text-xs">superseded</span>),{' '}
                  <em>or</em> mark them as{' '}
                  <span className="font-mono text-xs">distinct records</span> —
                  same entity slug, independent real-world records (e.g. same
                  business name + different client_id, or same metric at
                  different time-points). Both moves are signed events on the
                  audit chain.
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
                  : 'sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
              }`}
            >
              {clusters.map((c) => {
                const head = c[0];
                const sources = [...new Set(c.map((f) => sourceKindOf(f.sourceRef)))];
                const recordRef = parseRecordRef(head.sourceRef);
                const latest = c.reduce<Date | null>((acc, f) => {
                  if (!f.observedAt) return acc;
                  return !acc || f.observedAt.getTime() > acc.getTime()
                    ? f.observedAt
                    : acc;
                }, null);
                return (
                  <div
                    key={head.id}
                    className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex items-baseline gap-1">
                      <span className="break-all text-2xl font-semibold tabular-nums">
                        {head.metricValue ?? '—'}
                      </span>
                      {head.metricUnit && (
                        <span className="text-xs text-zinc-500">{head.metricUnit}</span>
                      )}
                    </div>

                    {/* SOURCE BLOCK — record-id + observedAt prominent */}
                    <dl className="rounded-md bg-white p-2 font-mono text-[10px] leading-relaxed dark:bg-black/40">
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-zinc-500">record</dt>
                        <dd className="break-all text-zinc-800 dark:text-zinc-200">
                          {recordRef.kind}:{recordRef.id}
                        </dd>
                      </div>
                      {latest && (
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-zinc-500">observed</dt>
                          <dd className="text-zinc-700 dark:text-zinc-300">
                            {latest.toISOString().slice(0, 10)}
                          </dd>
                        </div>
                      )}
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-zinc-500">facts</dt>
                        <dd className="text-zinc-700 dark:text-zinc-300">
                          {c.length}
                          {sources.length > 0 && (
                            <span className="ml-1 text-zinc-500">
                              · {sources.join(',')}
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>

                    <details className="rounded-md bg-white p-2 text-[11px] leading-snug dark:bg-black/40">
                      <summary className="cursor-pointer font-medium text-zinc-600 dark:text-zinc-400">
                        excerpt
                      </summary>
                      <p className="mt-1 text-zinc-700 dark:text-zinc-300">
                        “{head.sourceExcerpt ?? head.claim}”
                      </p>
                      <p className="mt-2 break-all font-mono text-[9px] text-zinc-500">
                        {head.sourceRef}
                      </p>
                    </details>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setPicked(head.id);
                        start(async () => {
                          try {
                            await resolveConflict({
                              mode: 'canonical',
                              entity,
                              metricKey,
                              winnerFactId: head.id,
                            });
                            setOpen(false);
                          } catch (e) {
                            setPicked(null);
                            console.error('[conflict-resolve]', e);
                          }
                        });
                      }}
                      className="mt-auto inline-flex h-9 items-center justify-center rounded-full bg-zinc-950 px-4 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      {pending && picked === head.id ? 'signing…' : 'Sign as canonical'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* DISTINCT-RECORDS option — for "same name, different real-world record" cases */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 dark:border-sky-700/50 dark:bg-sky-950/30">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-sky-900 dark:text-sky-300">
                  same name, different records?
                </p>
                <p className="mt-0.5 text-xs leading-snug text-sky-900/80 dark:text-sky-200/80">
                  If the candidates above describe independent real-world things
                  (different client_ids, different time-windows…), mark them as
                  distinct. Canon signs the acknowledgement; nothing gets
                  superseded.
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setPicked('__distinct__');
                  start(async () => {
                    try {
                      await resolveConflict({
                        mode: 'distinct',
                        entity,
                        metricKey,
                        candidateFactIds: allCandidateFactIds,
                      });
                      setOpen(false);
                    } catch (e) {
                      setPicked(null);
                      console.error('[conflict-resolve:distinct]', e);
                    }
                  });
                }}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-sky-700 bg-sky-100 px-4 text-xs font-medium text-sky-900 transition-colors hover:bg-sky-200 disabled:opacity-60 dark:border-sky-500 dark:bg-sky-900/40 dark:text-sky-100 dark:hover:bg-sky-900/70"
              >
                {pending && picked === '__distinct__'
                  ? 'signing…'
                  : 'Keep all · sign as distinct'}
              </button>
            </div>

            {overflow > 0 && (
              <p className="mt-4 font-mono text-[11px] text-zinc-500">
                + {overflow} smaller cluster{overflow === 1 ? '' : 's'} not
                shown · audit-history accessible via{' '}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  view proof
                </span>{' '}
                on individual facts.
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

/**
 * Pull the record-id out of a sourceRef so the modal can show it on the
 * "record" row prominently. Examples:
 *   "qontext:client:abc-def-..." → { kind: 'client', id: 'abc-def-...' }
 *   "qontext:vendor:xyz"        → { kind: 'vendor', id: 'xyz' }
 *   "slack:C01:1234.5678#s2"    → { kind: 'slack', id: 'C01:1234.5678#s2' }
 *   "gmail:msg-id"              → { kind: 'gmail', id: 'msg-id' }
 */
function parseRecordRef(sourceRef: string): { kind: string; id: string } {
  const parts = sourceRef.split(':');
  if (parts[0] === 'qontext' && parts.length >= 3) {
    return { kind: parts[1], id: trimId(parts.slice(2).join(':')) };
  }
  return { kind: parts[0], id: trimId(parts.slice(1).join(':')) };
}

function trimId(s: string): string {
  if (s.length <= 24) return s;
  return s.slice(0, 12) + '…' + s.slice(-8);
}
