'use client';

import { useState, useTransition } from 'react';
import type { FactRow } from '@/lib/canon/view';
import { resolveConflict } from '../_actions/resolve';

interface Props {
  entity: string;
  metricKey: string;
  competing: FactRow[];
}

export function ConflictResolve({ entity, metricKey, competing }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);

  if (competing.length < 2) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
      >
        ⚠ resolve
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 py-12 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-mono uppercase tracking-wide text-zinc-500">
                  resolve conflict · {entity}.{metricKey}
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  Two or more sources disagree.
                </h2>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Pick the source of truth. Canon will sign your decision and
                  retain the others as audit history.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-2xl leading-none text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50"
              >
                ×
              </button>
            </div>

            <ul className="mt-6 space-y-3">
              {competing.map((f) => (
                <li
                  key={f.id}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold">
                        {f.metricValue}
                        {f.metricUnit ? (
                          <span className="ml-1 text-sm font-medium text-zinc-500">
                            {f.metricUnit}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        “{f.sourceExcerpt ?? f.claim}”
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-zinc-500">
                        {f.sourceRef} · {f.observedAt?.toISOString().slice(0, 10) ?? '—'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setPicked(f.id);
                        start(async () => {
                          await resolveConflict({
                            entity,
                            metricKey,
                            winnerFactId: f.id,
                          });
                          setOpen(false);
                        });
                      }}
                      className="rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      {pending && picked === f.id ? 'signing…' : 'pick as truth'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
