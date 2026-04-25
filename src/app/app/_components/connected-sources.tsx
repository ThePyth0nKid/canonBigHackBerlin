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
 *
 * Brand-recognition: each source uses an inline SVG brand mark + the
 * established brand-color convention from SourcePill (slack=violet,
 * gmail=rose, pdf=amber, qontext=sky). Single-char placeholders read as
 * abstract noise on stage — real brand marks land instantly.
 */

import { useState } from 'react';
import type { SourceStatus } from '@/lib/canon/view';

interface BrandStyle {
  /** uppercase short label rendered in pills + cards */
  label: string;
  /** tailwind bg class for the colored dot (matches SourcePill) */
  dotBg: string;
  /** tailwind text class for the brand name in cards */
  textColor: string;
  /** SVG brand mark, sized 14px */
  icon: React.ReactNode;
}

const BRAND: Record<string, BrandStyle> = {
  slack: {
    label: 'SLACK',
    dotBg: 'bg-violet-500',
    textColor: 'text-violet-700 dark:text-violet-300',
    icon: <SlackIcon />,
  },
  gmail: {
    label: 'GMAIL',
    dotBg: 'bg-rose-500',
    textColor: 'text-rose-700 dark:text-rose-300',
    icon: <GmailIcon />,
  },
  pdf: {
    label: 'PDF',
    dotBg: 'bg-amber-500',
    textColor: 'text-amber-700 dark:text-amber-300',
    icon: <PdfIcon />,
  },
  qontext: {
    label: 'QONTEXT',
    dotBg: 'bg-sky-500',
    textColor: 'text-sky-700 dark:text-sky-300',
    icon: <DatasetIcon />,
  },
};

function brandFor(kind: string): BrandStyle {
  return (
    BRAND[kind] ?? {
      label: kind.toUpperCase(),
      dotBg: 'bg-zinc-400',
      textColor: 'text-zinc-600 dark:text-zinc-300',
      icon: <span aria-hidden>·</span>,
    }
  );
}

export function ConnectedSources({ sources }: { sources: SourceStatus[] }) {
  const [expanded, setExpanded] = useState(false);
  // Count what actually contributes facts to the ledger — drops noise rows
  // like "configured but never synced" without inventing an internal "live"
  // classification the user has no context for.
  const contributing = sources.filter((s) => s.factCount > 0);
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {contributing.length} source{contributing.length === 1 ? '' : 's'} feeding this ledger
          </span>
          <div className="flex items-center gap-1.5">
            {sources.map((s) => (
              <SourceChip key={s.kind} source={s} />
            ))}
          </div>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
          {expanded ? 'hide details −' : 'show details +'}
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

function SourceChip({ source }: { source: SourceStatus }) {
  const b = brandFor(source.kind);
  const dim = !source.ready || source.factCount === 0 ? 'opacity-50' : '';
  return (
    <span
      title={`${b.label} · ${source.factCount} active${source.ready ? '' : ' · not configured'}`}
      className={`inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 ${dim}`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${b.dotBg}`} aria-hidden />
      {b.label}
    </span>
  );
}

function SourceCard({ source }: { source: SourceStatus }) {
  const b = brandFor(source.kind);
  const status = !source.ready
    ? { label: 'not configured', color: 'text-zinc-400' }
    : source.factCount === 0
      ? { label: 'configured · empty', color: 'text-amber-700 dark:text-amber-400' }
      : { label: 'live', color: 'text-emerald-700 dark:text-emerald-400' };

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${b.dotBg} text-white`}
          >
            {b.icon}
          </span>
          <div className="flex flex-col">
            <span
              className={`font-mono text-[11px] font-bold uppercase tracking-[0.14em] ${b.textColor}`}
            >
              {b.label}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">
              {source.displayName}
            </span>
          </div>
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

/* -------------------------------------------------------------------------- *
 * Brand SVGs — geometric, single-stroke, monochrome (paint inherits from
 * the wrapping <span>'s color). Recognizable shapes without copying the
 * exact registered logos (which would be a trademark issue at booth-scale).
 * -------------------------------------------------------------------------- */

function SlackIcon() {
  // Four rounded rectangles arranged in the iconic Slack pinwheel layout.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
      <rect x="2" y="6" width="3" height="1.5" rx="0.75" />
      <rect x="2" y="6" width="1.5" height="4" rx="0.75" />
      <rect x="6" y="2" width="1.5" height="3" rx="0.75" />
      <rect x="6" y="2" width="4" height="1.5" rx="0.75" />
      <rect x="11" y="8.5" width="3" height="1.5" rx="0.75" />
      <rect x="12.5" y="6" width="1.5" height="4" rx="0.75" />
      <rect x="6" y="11" width="4" height="1.5" rx="0.75" />
      <rect x="8.5" y="11" width="1.5" height="3" rx="0.75" />
    </svg>
  );
}

function GmailIcon() {
  // Open envelope with the diagonal "M" creases that read as Gmail.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M1.5 4.5 L8 9 L14.5 4.5" />
    </svg>
  );
}

function PdfIcon() {
  // Document with corner-fold + "PDF" cue via a small bar.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d="M3.5 1.5 L10 1.5 L13 4.5 L13 14.5 L3.5 14.5 Z" />
      <path d="M10 1.5 L10 4.5 L13 4.5" />
      <path d="M5.5 9.5 L10.5 9.5" />
      <path d="M5.5 11.5 L9 11.5" />
    </svg>
  );
}

function DatasetIcon() {
  // Stacked discs — universal "database" / "dataset" mark.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <ellipse cx="8" cy="3.5" rx="5" ry="1.5" />
      <path d="M3 3.5 L3 8 C3 8.83 5.24 9.5 8 9.5 C10.76 9.5 13 8.83 13 8 L13 3.5" />
      <path d="M3 8 L3 12.5 C3 13.33 5.24 14 8 14 C10.76 14 13 13.33 13 12.5 L13 8" />
    </svg>
  );
}
