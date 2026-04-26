'use client';

import { useState } from 'react';

/**
 * Plain-language workflow primer for first-time visitors of /decide.
 *
 * Mirrors the four StepTracker dots on each card so the audience can
 * read the dots without a glossary. Collapsible — once read, the user
 * tucks it away. Default-open because the demo audience hasn't seen
 * the workflow before; a returning admin can dismiss with one click.
 */
export function HowItWorks() {
  const [open, setOpen] = useState(true);
  return (
    <section
      aria-label="How decisions flow"
      className="mb-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 font-mono text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300"
          >
            ?
          </span>
          <span className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            How decisions flow
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            4 stages · click to {open ? 'hide' : 'expand'}
          </span>
        </span>
        <span aria-hidden className="font-mono text-xs text-zinc-500">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <ol className="mt-3 grid gap-2 sm:grid-cols-4">
          <Step
            n={1}
            label="Auto-resolve"
            body="Canon tries first: majority + 2+ distinct sources wins automatically."
          />
          <Step
            n={2}
            label="Ask source-authors"
            body="Tied / no majority? Email the people whose Slack/Gmail messages produced each value."
          />
          <Step
            n={3}
            label="Decision"
            body="Authors agreed → consensus. They diverged or stayed silent → escalate to the deal owner."
          />
          <Step
            n={4}
            label="Signed canon"
            body="A signed FactEvent lands at the chain tip. Every agent in the workspace sees it instantly."
          />
        </ol>
      )}
    </section>
  );
}

function Step({
  n,
  label,
  body,
}: {
  n: number;
  label: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 dark:border-zinc-900 dark:bg-zinc-900/40">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white font-mono text-[10px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
      >
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
          {label}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
          {body}
        </p>
      </div>
    </li>
  );
}
