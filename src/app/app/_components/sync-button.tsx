'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface SyncResult {
  sources: { label: string; drafts: number; active: number; error?: string }[];
  conflicts: number;
  corroborated: number;
  resolved: number;
  totalActive: number;
  durationMs: number;
}

/**
 * Header "Sync now" button. Calls /api/sync, then refreshes the server
 * component tree so the new FactEvent rows render. Audit defaults to
 * skipped for snappy live demos — toggle via ?audit=on.
 *
 * UX:
 *   - The button itself shows a spinner during the request and a green
 *     "✓ synced" state for a moment after success — fixed width keeps
 *     the header layout stable.
 *   - A floating toast in the bottom-right gives the full per-run
 *     summary; auto-dismisses after 6s, dismissible by click.
 */
export function SyncButton({ skipAuditDefault = true }: { skipAuditDefault?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<
    | { kind: 'ok'; result: SyncResult }
    | { kind: 'err'; message: string }
    | null
  >(null);
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => {
    if (!toast) return;
    // 12s gives Nelson enough narration time on stage; click-x dismisses sooner.
    const t = setTimeout(() => setToast(null), 12000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!justSynced) return;
    const t = setTimeout(() => setJustSynced(false), 2200);
    return () => clearTimeout(t);
  }, [justSynced]);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setToast(null);
          start(async () => {
            try {
              const url = `/api/sync${skipAuditDefault ? '?audit=off' : ''}`;
              const res = await fetch(url, { method: 'POST' });
              const data = (await res.json()) as SyncResult & { error?: string; message?: string };
              if (!res.ok) {
                throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
              }
              setToast({ kind: 'ok', result: data });
              setJustSynced(true);
              router.refresh();
            } catch (e) {
              setToast({ kind: 'err', message: (e as Error).message ?? 'sync failed' });
            }
          });
        }}
        className={`inline-flex h-9 min-w-[120px] items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-90 ${
          justSynced
            ? 'bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-white'
            : 'bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200'
        }`}
      >
        {pending ? (
          <>
            <Spinner /> syncing…
          </>
        ) : justSynced ? (
          <>
            <CheckIcon /> synced
          </>
        ) : (
          <>
            <span aria-hidden>⇄</span> Sync now
          </>
        )}
      </button>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  );
}

function Toast({
  toast,
  onClose,
}: {
  toast:
    | { kind: 'ok'; result: SyncResult }
    | { kind: 'err'; message: string };
  onClose: () => void;
}) {
  if (toast.kind === 'err') {
    return (
      <div className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl border border-rose-300 bg-rose-50 p-4 shadow-lg dark:border-rose-700 dark:bg-rose-950/80">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
              Sync failed
            </p>
            <p className="mt-1 break-words text-xs text-rose-800 dark:text-rose-300">
              {toast.message}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none text-rose-700 hover:text-rose-900 dark:text-rose-300 dark:hover:text-rose-100"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  const r = toast.result;
  const seconds = (r.durationMs / 1000).toFixed(1);
  const okSources = r.sources.filter((s) => !s.error);
  const errSources = r.sources.filter((s) => s.error);

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 overflow-hidden rounded-2xl border border-emerald-300 bg-white shadow-xl dark:border-emerald-700 dark:bg-zinc-950">
      <div className="flex items-start gap-3 border-b border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
        <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">
          <CheckIcon small />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Synced in {seconds}s
          </p>
          <p className="mt-0.5 text-xs text-emerald-800 dark:text-emerald-300">
            {r.totalActive} signed facts · {r.corroborated} corroborated · {r.conflicts} conflict{r.conflicts === 1 ? '' : 's'}{r.resolved > 0 ? ` (${r.resolved} auto-resolved)` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-lg leading-none text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
        >
          ×
        </button>
      </div>
      <ul className="space-y-1 p-4 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
        {okSources.map((s) => (
          <li key={s.label} className="flex items-baseline justify-between">
            <span className="uppercase tracking-wide">{s.label}</span>
            <span>{s.active} active{s.drafts !== s.active ? ` / ${s.drafts} drafts` : ''}</span>
          </li>
        ))}
        {errSources.map((s) => (
          <li
            key={s.label}
            className="flex items-baseline justify-between text-rose-600 dark:text-rose-400"
          >
            <span className="uppercase tracking-wide">{s.label}</span>
            <span className="truncate">✗ {s.error}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
      aria-hidden
    />
  );
}

function CheckIcon({ small }: { small?: boolean } = {}) {
  const size = small ? 'h-3 w-3' : 'h-4 w-4';
  return (
    <svg
      viewBox="0 0 16 16"
      className={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8.5L7 12L13 4.5" />
    </svg>
  );
}
