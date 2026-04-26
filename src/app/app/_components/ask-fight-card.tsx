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
import { reverseResolution } from '../_actions/reverse-resolution';
import { coSignResolution } from '../_actions/cosign-resolution';
import type { ConflictCandidate, InlineConflict } from '@/lib/canon/ask';
import { BrandChip, brandFor } from './ask-source-brand';
import { useConfirmStep } from './use-confirm-step';
import { ConfirmSignRow } from './confirm-sign-row';
import { riskTier, tierExplain } from '@/lib/canon/risk-tier';

type FightOutcome =
  | {
      kind: 'canonical';
      winnerFactId: string;
      superseded: number;
      resolutionFactId: string;
    }
  | {
      kind: 'pending';
      winnerFactId: string;
      resolutionFactId: string;
    }
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
  const [reverseNote, setReverseNote] = useState<string | null>(null);
  const confirm = useConfirmStep(1500);

  const allFactIds = conflict.candidates.map((c) => c.factId);
  const visible = showAll
    ? conflict.candidates
    : conflict.candidates.slice(0, CANDIDATES_VISIBLE);
  const hidden = conflict.candidates.length - visible.length;
  // Server supersedes every active competing fact except the winner.
  const otherActiveCount = Math.max(0, conflict.candidates.length - 1);
  const tier = riskTier(conflict.metricKey);
  const isHighRisk = tier === 'high';

  function pickCanonical(winnerFactId: string) {
    confirm.cancel();
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
        if (r.pending) {
          setOutcome({
            kind: 'pending',
            winnerFactId,
            resolutionFactId: r.resolutionFactId ?? '',
          });
        } else {
          setOutcome({
            kind: 'canonical',
            winnerFactId,
            superseded: r.superseded,
            resolutionFactId: r.resolutionFactId ?? '',
          });
        }
        setPendingId(null);
      } catch (e) {
        setError((e as Error).message ?? 'Resolve failed');
        setPendingId(null);
      }
    });
  }

  function markDistinct() {
    confirm.cancel();
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

  const winnerFactId =
    outcome?.kind === 'canonical' || outcome?.kind === 'pending'
      ? outcome.winnerFactId
      : null;
  const resolved = !!outcome;
  const pendingCosign = outcome?.kind === 'pending';

  return (
    <article
      id={`fight-${conflict.entity}-${conflict.metricKey}`}
      className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-white shadow-sm transition-colors dark:bg-zinc-950 ${
        pendingCosign
          ? 'border-violet-400 dark:border-violet-600/60'
          : resolved
            ? 'border-emerald-300 dark:border-emerald-700/60'
            : 'border-amber-300 dark:border-amber-700/60'
      }`}
    >
      {/* HEADER — entity + metric + position in queue. Big enough that the
          user sees "what am I deciding here" before the candidates. */}
      <header
        className={`flex flex-wrap items-baseline justify-between gap-3 border-b px-4 py-3 ${
          pendingCosign
            ? 'border-violet-200 bg-violet-50/60 dark:border-violet-800/50 dark:bg-violet-950/30'
            : resolved
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
        <div className="flex flex-col items-end gap-1">
          {isHighRisk && !resolved && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-violet-500 bg-violet-100 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-violet-900 dark:border-violet-400 dark:bg-violet-900/40 dark:text-violet-100"
              title={tierExplain('high')}
            >
              <span aria-hidden>👁️👁️</span>
              4-eyes required
            </span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {conflict.candidates.length} competing values
          </span>
        </div>
      </header>

      {/* CANDIDATES — vertical stack so each row is a complete unit the
          eye can read in one sweep. Top 2 by default; rest collapsed. */}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {visible.map((cand) => (
          <CandidateRow
            key={cand.factId}
            cand={cand}
            isWinner={winnerFactId === cand.factId}
            isLoser={
              outcome?.kind === 'canonical' && winnerFactId !== cand.factId
            }
            isPending={pending && pendingId === cand.factId}
            disabled={pending || resolved}
            isArmed={confirm.isArmed(cand.factId)}
            isReady={confirm.isReady(cand.factId)}
            consequence={
              isHighRisk
                ? `4-eyes metric. Your pick is signed as resolution-PENDING; ${otherActiveCount} other candidate${otherActiveCount === 1 ? '' : 's'} stay active until a SECOND admin co-signs (then they flip to superseded).`
                : `This becomes Source of Truth for ${conflict.entityDisplay} · ${conflict.metricKey}. ${otherActiveCount} other candidate${otherActiveCount === 1 ? '' : 's'} flip to superseded. Signed + permanent on the audit chain (admin reverse required to undo).`
            }
            onArm={() => confirm.arm(cand.factId)}
            onConfirm={() => pickCanonical(cand.factId)}
            onCancel={confirm.cancel}
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
      {!resolved && !confirm.isArmed('__distinct__') && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-2 dark:border-zinc-900 dark:bg-zinc-900/30">
          <p className="font-mono text-[10px] text-zinc-500">
            None of these are wrong? Mark them as independent records.
          </p>
          <button
            type="button"
            onClick={() => confirm.arm('__distinct__')}
            disabled={pending}
            className="inline-flex h-7 items-center justify-center rounded-full border border-sky-400 bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-sky-800 transition-colors hover:bg-sky-50 disabled:opacity-60 dark:border-sky-600 dark:bg-zinc-950 dark:text-sky-200 dark:hover:bg-sky-950/60"
          >
            Mark as distinct
          </button>
        </footer>
      )}

      {!resolved && confirm.isArmed('__distinct__') && (
        <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 dark:border-zinc-900 dark:bg-zinc-900/30">
          <ConfirmSignRow
            consequence={`Sign acknowledgement that ${allFactIds.length} candidate fact${allFactIds.length === 1 ? '' : 's'} are independent records (none gets superseded). Signed + permanent on the audit chain.`}
            ready={confirm.isReady('__distinct__')}
            pending={pending && pendingId === '__distinct__'}
            onConfirm={markDistinct}
            onCancel={confirm.cancel}
            variant="distinct"
          />
        </div>
      )}

      {outcome && outcome.kind === 'pending' && (
        <PendingCosignFooter
          outcome={outcome}
          onCosigned={(supersededNow, cosignerEmail) => {
            // Co-sign succeeded: pending → resolution, losers superseded.
            // Promote the outcome to canonical so the visual state matches.
            setOutcome({
              kind: 'canonical',
              winnerFactId: outcome.winnerFactId,
              superseded: supersededNow,
              resolutionFactId: outcome.resolutionFactId,
            });
            setReverseNote(
              `✓ Co-signed by ${cosignerEmail} · ${supersededNow} fact${supersededNow === 1 ? '' : 's'} superseded`,
            );
          }}
        />
      )}

      {outcome && outcome.kind !== 'pending' && (
        <SignedFooter
          outcome={outcome}
          onReversed={(reactivated) => {
            // Re-arm the card for a fresh decision: clear outcome, drop any
            // pending state, surface a note that the reverse signed.
            setOutcome(null);
            setPendingId(null);
            setError(null);
            setReverseNote(
              `↺ Reverse-resolution signed at chain tip · ${reactivated} fact${reactivated === 1 ? '' : 's'} re-activated`,
            );
          }}
        />
      )}

      {reverseNote && !outcome && (
        <p className="border-t border-amber-300 bg-amber-50 px-4 py-2 font-mono text-[10px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          {reverseNote}
        </p>
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
  isArmed,
  isReady,
  consequence,
  onArm,
  onConfirm,
  onCancel,
}: {
  cand: ConflictCandidate;
  isWinner: boolean;
  isLoser: boolean;
  isPending: boolean;
  disabled: boolean;
  isArmed: boolean;
  isReady: boolean;
  consequence: string;
  onArm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
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
          winner has already been chosen for this card. Armed state takes
          over the full right column with the inline confirm strip. */}
      <div className={`self-center ${isArmed ? 'w-full sm:w-[18rem] sm:flex-shrink-0' : 'flex-shrink-0'}`}>
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
        ) : isArmed ? (
          <ConfirmSignRow
            consequence={consequence}
            ready={isReady}
            pending={isPending}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : (
          <button
            type="button"
            onClick={onArm}
            disabled={disabled}
            className="inline-flex h-9 items-center justify-center rounded-full bg-zinc-950 px-4 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Sign as canonical
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Outcome footer with admin-reverse affordance.
 *
 * The reverse path is gated server-side (requireAdmin in
 * reverseResolution); the button is always rendered so the demo flow
 * works in any session, but a non-admin click returns a clear
 * 'admin-required' error which we surface inline.
 *
 * On success the parent re-arms the fight card (clears outcome state)
 * so the original candidates re-render. The reverse event itself is
 * permanent on the chain — the audit trail reads forwards (resolution)
 * and backwards (reverse-of:hash) without ever rewriting history.
 */
function SignedFooter({
  outcome,
  onReversed,
}: {
  outcome: FightOutcome;
  onReversed: (reactivated: number) => void;
}) {
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reversePending, startReverse] = useTransition();
  const [reverseError, setReverseError] = useState<string | null>(null);

  function submitReverse() {
    setReverseError(null);
    startReverse(async () => {
      try {
        const r = await reverseResolution({
          resolutionFactId: outcome.resolutionFactId,
          reason: reverseReason,
        });
        if (!r.ok) {
          setReverseError(
            r.error === 'admin-required'
              ? 'Admin role required to reverse a signed resolution.'
              : r.error,
          );
          return;
        }
        onReversed(r.reactivated);
      } catch (e) {
        setReverseError((e as Error).message ?? 'Reverse failed');
      }
    });
  }

  return (
    <footer className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 dark:border-emerald-800/50 dark:bg-emerald-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-emerald-900 dark:text-emerald-200">
        <div>
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
        </div>
        {!reverseOpen && outcome.resolutionFactId && (
          <button
            type="button"
            onClick={() => setReverseOpen(true)}
            className="inline-flex h-6 items-center justify-center rounded-full border border-emerald-700/50 bg-white/40 px-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-emerald-900 hover:bg-white/80 dark:border-emerald-500/40 dark:bg-black/30 dark:text-emerald-100 dark:hover:bg-black/50"
            title="Sign a reverse-resolution event (admin only) — re-activates the superseded facts and records the reversal on the chain."
          >
            ↺ reverse · admin
          </button>
        )}
      </div>

      {reverseOpen && (
        <div className="mt-2 space-y-2 rounded-md border border-emerald-300 bg-white/70 p-2 dark:border-emerald-700/50 dark:bg-black/30">
          <label className="block font-mono text-[9px] uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
            reason · permanent on chain
          </label>
          <textarea
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="e.g. wrong winner — contract value 240k was a typo, real ARR is 2.4M"
            disabled={reversePending}
            rows={2}
            className="w-full resize-y rounded-md border border-emerald-300 bg-white p-2 font-mono text-[10px] leading-snug text-zinc-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-60 dark:border-emerald-700/40 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setReverseOpen(false);
                setReverseReason('');
                setReverseError(null);
              }}
              disabled={reversePending}
              className="inline-flex h-7 items-center justify-center rounded-full border border-zinc-300 px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={submitReverse}
              disabled={reversePending || reverseReason.trim().length < 3}
              className="inline-flex h-7 items-center justify-center rounded-full bg-amber-700 px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-white hover:bg-amber-800 disabled:bg-amber-400 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
              {reversePending ? 'signing reverse…' : 'sign reverse-resolution'}
            </button>
          </div>
          {reverseError && (
            <p className="font-mono text-[10px] text-rose-700 dark:text-rose-300">
              {reverseError}
            </p>
          )}
        </div>
      )}
    </footer>
  );
}

/**
 * 4-eyes pending state. The proposal is signed and on the chain
 * (status='resolution-pending') but no facts have been superseded
 * yet — the losers stay 'active'. A SECOND admin must call
 * coSignResolution() to make the supersedure apply.
 *
 * The cosign call is server-gated: requireAdmin + email !== initiator.
 * Demo behaviour with a single user is honest — the button returns
 * 'same-as-initiator' which we surface inline so the audience sees
 * exactly what blocks the pick from taking effect.
 */
function PendingCosignFooter({
  outcome,
  onCosigned,
}: {
  outcome: { kind: 'pending'; winnerFactId: string; resolutionFactId: string };
  onCosigned: (supersededNow: number, cosignerEmail: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      try {
        const r = await coSignResolution({
          resolutionFactId: outcome.resolutionFactId,
        });
        if (!r.ok) {
          setError(
            r.error === 'admin-required'
              ? 'Admin role required to co-sign.'
              : r.error === 'same-as-initiator'
                ? 'Co-sign refused — same email as the initiator. A SECOND admin must sign for high-risk picks.'
                : r.error,
          );
          return;
        }
        onCosigned(r.superseded, r.cosignerEmail);
      } catch (e) {
        setError((e as Error).message ?? 'Co-sign failed');
      }
    });
  }

  return (
    <footer className="border-t border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800/50 dark:bg-violet-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-900 dark:text-violet-200">
            <span aria-hidden className="mr-1">👁️👁️</span>
            awaiting 4-eyes co-sign
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-violet-900/80 dark:text-violet-100/80">
            Pick is signed as resolution-PENDING (
            <span className="font-mono">{outcome.resolutionFactId.slice(0, 14)}…</span>
            ). Losers stay active; supersedure applies only after a SECOND
            admin co-signs.
          </p>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="inline-flex h-8 items-center justify-center rounded-full bg-violet-700 px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-white hover:bg-violet-800 disabled:bg-violet-400 dark:bg-violet-600 dark:hover:bg-violet-700"
        >
          {pending ? 'co-signing…' : 'co-sign · sign as canonical'}
        </button>
      </div>
      {error && (
        <p className="mt-2 font-mono text-[10px] text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </footer>
  );
}
