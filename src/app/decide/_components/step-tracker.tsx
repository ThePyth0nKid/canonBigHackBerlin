/**
 * Horizontal 4-stage tracker for a DecisionCard.
 *
 * Reads like a delivery tracker: auto-resolve → asked → consensus/escalation
 * → signed canon. Color and icon swap with the card's current stage.
 */

import type { DecisionStage } from '@/lib/canon/decide-view';

interface StepTrackerProps {
  stage: DecisionStage;
  /** When true, the "Asked authors" dot renders as skipped (struck through). */
  skipAsk?: boolean;
}

const DOTS = [
  { key: 'auto', label: 'Auto-resolve' },
  { key: 'ask', label: 'Asked authors' },
  { key: 'decide', label: 'Decision' },
  { key: 'signed', label: 'Signed canon' },
] as const;

function activeIndex(stage: DecisionStage): number {
  switch (stage) {
    case 'fresh':
      return 0;
    case 'asked':
    case 'partial_response':
      return 1;
    case 'consensus':
    case 'diverged':
    case 'escalated':
      return 2;
    case 'resolved':
      return 3;
  }
}

function dotClass(idx: number, active: number, stage: DecisionStage): string {
  if (idx < active) return 'bg-emerald-500 border-emerald-600 text-white';
  if (idx > active) return 'bg-zinc-100 border-zinc-300 text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-500';
  // current dot — color by stage flavor
  if (stage === 'diverged' || stage === 'escalated') {
    return 'bg-amber-500 border-amber-600 text-white animate-pulse';
  }
  if (stage === 'resolved') return 'bg-emerald-600 border-emerald-700 text-white';
  return 'bg-sky-500 border-sky-600 text-white animate-pulse';
}

function lineClass(beforeIdx: number, active: number): string {
  return beforeIdx < active
    ? 'bg-emerald-500'
    : 'bg-zinc-200 dark:bg-zinc-700';
}

export function StepTracker({ stage, skipAsk = false }: StepTrackerProps) {
  const active = activeIndex(stage);
  return (
    <div className="flex items-center gap-1 py-2">
      {DOTS.map((d, i) => {
        const isAskDot = d.key === 'ask';
        const skipped = isAskDot && skipAsk && active <= 1;
        const cls = skipped
          ? 'bg-zinc-200 border-zinc-300 text-zinc-500 line-through dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-500'
          : dotClass(i, active, stage);
        return (
          <div key={d.key} className="flex flex-1 items-center gap-1">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${cls}`}
              aria-label={skipped ? `${d.label} (skipped)` : d.label}
              title={skipped ? `${d.label} (skipped — no human authors)` : d.label}
            >
              {skipped ? '–' : i < active ? '✓' : i === active && stage === 'resolved' ? '✓' : i + 1}
            </div>
            {i < DOTS.length - 1 && (
              <div className={`h-0.5 flex-1 ${lineClass(i, active)}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StageBadge({ stage }: { stage: DecisionStage }) {
  const styles: Record<DecisionStage, string> = {
    fresh: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    asked: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
    partial_response: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
    consensus: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    diverged: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    escalated: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
    resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  };
  const labels: Record<DecisionStage, string> = {
    fresh: 'Auto-resolve failed',
    asked: 'Asked source-authors',
    partial_response: 'Partial response',
    consensus: 'Consensus reached',
    diverged: 'Authors diverged',
    escalated: 'Escalated to authority',
    resolved: 'Signed canon',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[stage]}`}
    >
      {labels[stage]}
    </span>
  );
}
