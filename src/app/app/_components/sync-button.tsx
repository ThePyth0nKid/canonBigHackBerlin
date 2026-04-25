'use client';

import { useState, useTransition } from 'react';
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
 */
export function SyncButton({ skipAuditDefault = true }: { skipAuditDefault?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setErr(null);
          setResult(null);
          start(async () => {
            try {
              const url = `/api/sync${skipAuditDefault ? '?audit=off' : ''}`;
              const res = await fetch(url, { method: 'POST' });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = (await res.json()) as SyncResult;
              setResult(data);
              router.refresh();
            } catch (e) {
              setErr((e as Error).message ?? 'sync failed');
            }
          });
        }}
        className="inline-flex h-9 items-center gap-2 rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {pending ? (
          <>
            <Spinner /> syncing…
          </>
        ) : (
          <>
            <span aria-hidden>⇄</span> Sync now
          </>
        )}
      </button>
      {result && (
        <span className="font-mono text-[10px] text-zinc-500">
          {result.totalActive} facts · {result.corroborated} corroborated · {result.conflicts} conflicts · {(result.durationMs / 1000).toFixed(1)}s
        </span>
      )}
      {err && (
        <span className="font-mono text-[10px] text-rose-500">sync error: {err}</span>
      )}
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
