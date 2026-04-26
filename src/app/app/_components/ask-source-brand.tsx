'use client';

/**
 * Source-brand helper specific to Ask-Canon answer surfaces. Mirrors the
 * established convention from `connected-sources.tsx` and `source-pill.tsx`
 * (slack=violet, gmail=rose, pdf=amber, qontext=sky, resolution=emerald)
 * so the chat answer doesn't introduce a competing palette. Lives in its
 * own file so both `ask-fight-card.tsx` and the citation list in
 * `ask-canon.tsx` can share it without circular imports.
 */

export interface AskBrand {
  /** Short uppercase label used in chips. */
  label: string;
  /** Tailwind background for the colored dot. */
  dotBg: string;
  /** Tailwind text colour for chip labels. */
  text: string;
  /** Tailwind border colour for chip outlines. */
  border: string;
  /** Tailwind soft background for chip surfaces. */
  bg: string;
  /** Inline SVG geometric mark, sized 10px. */
  icon: React.ReactNode;
}

const BRAND: Record<string, AskBrand> = {
  slack: {
    label: 'SLACK',
    dotBg: 'bg-violet-500',
    text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-300 dark:border-violet-700/60',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    icon: <SlackIcon />,
  },
  gmail: {
    label: 'GMAIL',
    dotBg: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-300 dark:border-rose-700/60',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    icon: <GmailIcon />,
  },
  pdf: {
    label: 'PDF',
    dotBg: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-700/60',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    icon: <PdfIcon />,
  },
  qontext: {
    label: 'QONTEXT',
    dotBg: 'bg-sky-500',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-300 dark:border-sky-700/60',
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    icon: <DatasetIcon />,
  },
  resolution: {
    label: 'PICK',
    dotBg: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-700/60',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    icon: <ResolutionIcon />,
  },
};

export function brandFor(kindOrRef: string): AskBrand {
  const k = kindOrRef.split(':', 1)[0].toLowerCase();
  return (
    BRAND[k] ?? {
      label: k.toUpperCase() || 'SOURCE',
      dotBg: 'bg-zinc-400',
      text: 'text-zinc-700 dark:text-zinc-300',
      border: 'border-zinc-300 dark:border-zinc-700',
      bg: 'bg-zinc-50 dark:bg-zinc-900/60',
      icon: <span aria-hidden>·</span>,
    }
  );
}

/**
 * Compact brand chip — used inside fight-card candidates and citation
 * cards. Renders the SVG mark + the uppercase label. Optional sourceRef
 * id appended in muted mono so the auditor can spot the exact record.
 */
export function BrandChip({
  sourceRef,
  showId = true,
}: {
  sourceRef: string;
  showId?: boolean;
}) {
  const b = brandFor(sourceRef);
  const id = showId ? trimRef(sourceRef) : null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] ${b.border} ${b.bg} ${b.text}`}
      title={sourceRef}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${b.dotBg}`} aria-hidden />
      {b.label}
      {id && <span className="font-normal opacity-60">{id}</span>}
    </span>
  );
}

function trimRef(sourceRef: string): string | null {
  const tail = sourceRef.split(':').slice(1).join(':');
  if (!tail) return null;
  if (tail.length <= 14) return tail;
  return tail.slice(0, 8) + '…';
}

/* -------------------------------------------------------------------------- *
 * Geometric brand marks — copy of the patterns in connected-sources.tsx so
 * this file is self-contained and we don't reach across into another
 * client component's internals.
 * -------------------------------------------------------------------------- */

function SlackIcon() {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden>
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
  return (
    <svg
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M1.5 4.5 L8 9 L14.5 4.5" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3.5 1.5 L10 1.5 L13 4.5 L13 14.5 L3.5 14.5 Z" />
      <path d="M10 1.5 L10 4.5 L13 4.5" />
    </svg>
  );
}

function DatasetIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <ellipse cx="8" cy="3.5" rx="5" ry="1.5" />
      <path d="M3 3.5 L3 12.5 C3 13.33 5.24 14 8 14 C10.76 14 13 13.33 13 12.5 L13 3.5" />
    </svg>
  );
}

function ResolutionIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8 L7 12 L13 4" />
    </svg>
  );
}
