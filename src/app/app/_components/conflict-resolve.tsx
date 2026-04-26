'use client';

import { useState, useTransition } from 'react';
import type { FactRow } from '@/lib/canon/view';
import { SourcePill } from './source-pill';
import { resolveConflict } from '../_actions/resolve';
import { summarizeConflictAction } from '../_actions/summarize-conflict';
import type { ConflictSummary } from '@/lib/canon/conflict-summary';
import { useConfirmStep } from './use-confirm-step';
import { ConfirmSignRow } from './confirm-sign-row';

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
  const confirm = useConfirmStep(1500);

  // Gemini summary state — separate from the resolve transition because
  // we don't want a long Gemini call to grey out the action buttons.
  const [summary, setSummary] = useState<ConflictSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryPending, startSummary] = useTransition();

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

  // Server supersedes ALL active competing facts except the winner — so the
  // count includes mates of the winning cluster (same value, multiple sources).
  const otherActiveCount = Math.max(0, competing.length - 1);

  function runCanonical(factId: string) {
    confirm.cancel();
    setPicked(factId);
    start(async () => {
      try {
        await resolveConflict({
          mode: 'canonical',
          entity,
          metricKey,
          winnerFactId: factId,
        });
        setOpen(false);
      } catch (e) {
        setPicked(null);
        console.error('[conflict-resolve:canonical]', e);
      }
    });
  }

  function runDistinct() {
    confirm.cancel();
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
  }

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

            {/* Gemini summary block — between the header and the candidate
                grid so it sits where the user looks first when deciding. */}
            <div className="mt-5 rounded-xl border border-violet-300 bg-violet-50/60 p-4 dark:border-violet-700/50 dark:bg-violet-950/30">
              {!summary && !summaryPending && !summaryError && (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">
                      Gemini · 2.5-flash
                    </p>
                    <p className="mt-0.5 text-sm text-violet-900 dark:text-violet-100">
                      Stuck? Get a 2-line analyst take on why these candidates
                      disagree + a recommendation.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSummaryError(null);
                      startSummary(async () => {
                        const res = await summarizeConflictAction({
                          entity,
                          metricKey,
                          factIds: allCandidateFactIds,
                        });
                        if ('error' in res) setSummaryError(res.error);
                        else setSummary(res);
                      });
                    }}
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-violet-700 bg-violet-100 px-4 text-xs font-semibold text-violet-900 transition-colors hover:bg-violet-200 dark:border-violet-500 dark:bg-violet-900/40 dark:text-violet-100 dark:hover:bg-violet-900/70"
                  >
                    Summarise with Gemini →
                  </button>
                </div>
              )}

              {summaryPending && (
                <p className="font-mono text-[11px] text-violet-700 dark:text-violet-300">
                  Gemini reading {allCandidateFactIds.length} candidates…
                </p>
              )}

              {summaryError && (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-rose-700 dark:text-rose-400">
                    {summaryError}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSummaryError(null);
                      setSummary(null);
                    }}
                    className="text-xs font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
                  >
                    retry
                  </button>
                </div>
              )}

              {summary && !summaryPending && (
                <SummaryCard
                  summary={summary}
                  competing={competing}
                  otherActiveCount={otherActiveCount}
                  distinctCount={allCandidateFactIds.length}
                  onPickWinner={runCanonical}
                  onMarkDistinct={runDistinct}
                  pending={pending}
                  picked={picked}
                  confirm={confirm}
                />
              )}
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

                    {confirm.isArmed(head.id) ? (
                      <div className="mt-auto">
                        <ConfirmSignRow
                          consequence={`This becomes Source of Truth. ${otherActiveCount} other active fact${otherActiveCount === 1 ? '' : 's'} will flip to superseded. Signed + permanent on the audit chain (admin reverse required to undo).`}
                          ready={confirm.isReady(head.id)}
                          pending={pending && picked === head.id}
                          onConfirm={() => runCanonical(head.id)}
                          onCancel={confirm.cancel}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => confirm.arm(head.id)}
                        className="mt-auto inline-flex h-9 items-center justify-center rounded-full bg-zinc-950 px-4 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                      >
                        Sign as canonical
                      </button>
                    )}
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
              {confirm.isArmed('__distinct__') ? (
                <div className="w-full sm:w-auto sm:min-w-[20rem]">
                  <ConfirmSignRow
                    consequence={`Sign acknowledgement that ${allCandidateFactIds.length} candidate fact${allCandidateFactIds.length === 1 ? '' : 's'} are independent records (none gets superseded). Signed + permanent on the audit chain.`}
                    ready={confirm.isReady('__distinct__')}
                    pending={pending && picked === '__distinct__'}
                    onConfirm={runDistinct}
                    onCancel={confirm.cancel}
                    variant="distinct"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => confirm.arm('__distinct__')}
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-sky-700 bg-sky-100 px-4 text-xs font-medium text-sky-900 transition-colors hover:bg-sky-200 disabled:opacity-60 dark:border-sky-500 dark:bg-sky-900/40 dark:text-sky-100 dark:hover:bg-sky-900/70"
                >
                  Keep all · sign as distinct
                </button>
              )}
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

function SummaryCard({
  summary,
  competing,
  otherActiveCount,
  distinctCount,
  onPickWinner,
  onMarkDistinct,
  pending,
  picked,
  confirm,
}: {
  summary: ConflictSummary;
  competing: FactRow[];
  otherActiveCount: number;
  distinctCount: number;
  onPickWinner: (factId: string) => void;
  onMarkDistinct: () => void;
  pending: boolean;
  picked: string | null;
  confirm: ReturnType<typeof useConfirmStep>;
}) {
  const winner = summary.winnerFactId
    ? competing.find((f) => f.id === summary.winnerFactId)
    : null;
  const tone =
    summary.recommendation === 'canonical'
      ? { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-900 dark:text-emerald-200', border: 'border-emerald-400 dark:border-emerald-700' }
      : summary.recommendation === 'distinct'
        ? { bg: 'bg-sky-100 dark:bg-sky-900/40', text: 'text-sky-900 dark:text-sky-200', border: 'border-sky-400 dark:border-sky-700' }
        : { bg: 'bg-zinc-100 dark:bg-zinc-800', text: 'text-zinc-700 dark:text-zinc-300', border: 'border-zinc-300 dark:border-zinc-700' };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-violet-700 dark:text-violet-300">
          Gemini · 2.5-flash · {summary.latencyMs}ms
        </p>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${tone.border} ${tone.bg} ${tone.text}`}
        >
          recommends · {summary.recommendation}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-violet-950 dark:text-violet-50">
        {summary.summary}
      </p>
      {summary.reasoning && (
        <p className="border-l-2 border-violet-300 pl-3 text-xs italic leading-snug text-violet-800 dark:border-violet-700/50 dark:text-violet-200/80">
          {summary.reasoning}
        </p>
      )}
      {winner && (
        <div className="rounded-lg bg-white/60 p-3 dark:bg-black/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-300">
                Gemini's pick
              </p>
              <p className="mt-0.5 break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {winner.metricValue ?? '—'}
                {winner.metricUnit ? ` ${winner.metricUnit}` : ''}
              </p>
              <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-500">
                factId: {winner.id}
              </p>
            </div>
            {!confirm.isArmed(winner.id) && (
              <button
                type="button"
                disabled={pending}
                onClick={() => confirm.arm(winner.id)}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-full bg-zinc-950 px-3 text-[11px] font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Sign as canonical
              </button>
            )}
          </div>
          {confirm.isArmed(winner.id) && (
            <div className="mt-2">
              <ConfirmSignRow
                consequence={`This becomes Source of Truth. ${otherActiveCount} other active fact${otherActiveCount === 1 ? '' : 's'} will flip to superseded. Signed + permanent on the audit chain (admin reverse required to undo).`}
                ready={confirm.isReady(winner.id)}
                pending={pending && picked === winner.id}
                onConfirm={() => onPickWinner(winner.id)}
                onCancel={confirm.cancel}
              />
            </div>
          )}
        </div>
      )}
      {summary.recommendation === 'distinct' && (
        confirm.isArmed('__distinct__') ? (
          <ConfirmSignRow
            consequence={`Sign acknowledgement that ${distinctCount} candidate fact${distinctCount === 1 ? '' : 's'} are independent records (none gets superseded). Signed + permanent on the audit chain.`}
            ready={confirm.isReady('__distinct__')}
            pending={pending && picked === '__distinct__'}
            onConfirm={onMarkDistinct}
            onCancel={confirm.cancel}
            variant="distinct"
          />
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => confirm.arm('__distinct__')}
              className="inline-flex h-8 items-center justify-center rounded-full border border-sky-700 bg-sky-100 px-3 text-[11px] font-medium text-sky-900 transition-colors hover:bg-sky-200 disabled:opacity-60 dark:border-sky-500 dark:bg-sky-900/40 dark:text-sky-100 dark:hover:bg-sky-900/70"
            >
              Keep all · sign as distinct
            </button>
          </div>
        )
      )}
    </div>
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
