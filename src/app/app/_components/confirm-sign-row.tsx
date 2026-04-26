'use client';

/**
 * Inline two-row confirmation that replaces a "Sign …" button after the
 * first click. The Confirm button stays disabled for `cooldownMs` so the
 * user can't reflex-click through. Cancel is always immediate.
 */
export function ConfirmSignRow({
  consequence,
  ready,
  pending,
  onConfirm,
  onCancel,
  variant = 'canonical',
}: {
  consequence: string;
  ready: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'canonical' | 'distinct';
}) {
  const tone =
    variant === 'distinct'
      ? 'border-sky-500 bg-sky-50 text-sky-950 dark:border-sky-600 dark:bg-sky-950/40 dark:text-sky-100'
      : 'border-rose-500 bg-rose-50 text-rose-950 dark:border-rose-600 dark:bg-rose-950/40 dark:text-rose-100';
  const confirmBtn =
    variant === 'distinct'
      ? 'bg-sky-700 text-white hover:bg-sky-800 disabled:bg-sky-400'
      : 'bg-rose-700 text-white hover:bg-rose-800 disabled:bg-rose-400';
  return (
    <div className={`flex flex-col gap-2 rounded-md border p-2 ${tone}`}>
      <p className="text-[11px] leading-snug">
        <span aria-hidden className="mr-1">⚠</span>
        {consequence}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={!ready || pending}
          className={`inline-flex h-7 flex-1 items-center justify-center rounded-full px-3 text-[10px] font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed ${confirmBtn}`}
        >
          {pending
            ? 'signing…'
            : ready
              ? variant === 'distinct'
                ? 'Confirm · sign distinct'
                : 'Confirm · sign canonical'
              : 'wait…'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex h-7 items-center justify-center rounded-full border border-current px-3 text-[10px] font-semibold uppercase tracking-wider hover:bg-white/50 dark:hover:bg-black/30 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
