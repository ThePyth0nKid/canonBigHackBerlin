/**
 * Tiny per-source pill — slack/gmail/pdf icon dot + name.
 * Used in fact rows and confirmation chips.
 */

const COLORS: Record<string, string> = {
  slack: 'bg-violet-500',
  gmail: 'bg-rose-500',
  pdf: 'bg-amber-500',
};

export function SourcePill({ kind }: { kind: string }) {
  const k = kind.toLowerCase();
  const color = COLORS[k] ?? 'bg-zinc-400';
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />
      {k}
    </span>
  );
}
