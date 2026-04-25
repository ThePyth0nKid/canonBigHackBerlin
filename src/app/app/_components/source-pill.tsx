/**
 * Per-source chip — slack/gmail/pdf colored dot + uppercase label.
 * Sized for stage projection (readable at 5m).
 */

const COLORS: Record<string, string> = {
  slack: 'bg-violet-500',
  gmail: 'bg-rose-500',
  pdf: 'bg-amber-500',
  resolution: 'bg-emerald-500',
};

const LABELS: Record<string, string> = {
  slack: 'SLACK',
  gmail: 'GMAIL',
  pdf: 'PDF',
  resolution: 'PICK',
};

export function SourcePill({ kind }: { kind: string }) {
  const k = kind.toLowerCase();
  const color = COLORS[k] ?? 'bg-zinc-400';
  const label = LABELS[k] ?? k.toUpperCase();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-[0.04em] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}
