'use client';

/**
 * "Connected sources" panel — sits above the Sync button so the audience
 * can see EXACTLY where Canon pulls its facts from before they watch the
 * pipeline run. Each row exposes the account/binding + the filter Canon
 * applies (Gmail subject query, Slack channel, etc.) + how recently the
 * source last contributed a signed fact.
 *
 * Trust transparency: there's no hidden second pipeline. What's listed
 * here is exactly what `/api/sync` invokes.
 */

import { useState } from 'react';
import type { SourceStatus } from '@/lib/canon/view';

const SOURCE_ICON: Record<string, string> = {
  slack: '#',
  gmail: '@',
  pdf: '¶',
  qontext: '◊',
};

export function ConnectedSources({ sources }: { sources: SourceStatus[] }) {
  const [expanded, setExpanded] = useState(false);
  const live = sources.filter((s) => s.kind !== 'qontext');
  const totalActive = sources.reduce((n, s) => n + s.factCount, 0);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            connected sources
          </span>
          <div className="flex items-center gap-1.5">
            {sources.map((s) => (
              <SourceDot key={s.kind} source={s} />
            ))}
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
          {totalActive.toLocaleString()} facts · {live.filter((s) => s.ready).length} of {live.length} live · {expanded ? '−' : '+'}
        </span>
      </button>

      {expanded && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {sources.map((s) => (
            <SourceCard key={s.kind} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceDot({ source }: { source: SourceStatus }) {
  const tone = !source.ready
    ? 'bg-zinc-300 dark:bg-zinc-700'
    : source.factCount === 0
      ? 'bg-amber-400/70'
      : 'bg-emerald-500';
  return (
    <span
      title={`${source.displayName} · ${source.factCount} active${source.ready ? '' : ' · not configured'}`}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full ${tone} px-1.5 font-mono text-[9px] font-bold text-white dark:text-zinc-900`}
    >
      {SOURCE_ICON[source.kind] ?? '·'}
    </span>
  );
}

function SourceCard({ source }: { source: SourceStatus }) {
  const status = !source.ready
    ? { label: 'not configured', color: 'text-zinc-400' }
    : source.factCount === 0
      ? { label: 'configured · empty', color: 'text-amber-700 dark:text-amber-400' }
      : { label: 'live', color: 'text-emerald-700 dark:text-emerald-400' };

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
            {SOURCE_ICON[source.kind] ?? '·'}
          </span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-200">
            {source.displayName}
          </span>
        </div>
        <span className={`font-mono text-[10px] uppercase tracking-wider ${status.color}`}>
          {status.label}
        </span>
      </div>

      {source.account && (
        <div className="mt-2 truncate font-mono text-[10px] text-zinc-500" title={source.account}>
          <span className="text-zinc-400">bound:</span> {source.account}
        </div>
      )}
      {source.filter && (
        <div className="mt-1 truncate font-mono text-[10px] text-zinc-500" title={source.filter}>
          <span className="text-zinc-400">filter:</span> {source.filter}
        </div>
      )}
      <div className="mt-2 flex items-baseline justify-between gap-2 font-mono text-[10px] text-zinc-500">
        <span>
          <span className="text-zinc-400">facts:</span>{' '}
          <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
            {source.factCount.toLocaleString()}
          </span>
        </span>
        <span>
          {source.lastFactAt ? (
            <>
              <span className="text-zinc-400">last:</span>{' '}
              {formatRelative(source.lastFactAt)}
            </>
          ) : (
            <span className="text-zinc-400">never synced</span>
          )}
        </span>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const dMs = Date.now() - t;
  if (dMs < 60_000) return `${Math.floor(dMs / 1000)}s ago`;
  if (dMs < 3_600_000) return `${Math.floor(dMs / 60_000)}m ago`;
  if (dMs < 86_400_000) return `${Math.floor(dMs / 3_600_000)}h ago`;
  return `${Math.floor(dMs / 86_400_000)}d ago`;
}
