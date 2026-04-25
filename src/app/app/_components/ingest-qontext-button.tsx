'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ProgressEvent {
  phase: 'init' | 'parse' | 'extract' | 'sign' | 'conflict' | 'done' | 'error';
  message?: string;
  done?: number;
  total?: number;
  data?: Record<string, unknown>;
}

const PHASE_LABEL: Record<ProgressEvent['phase'], string> = {
  init: 'INIT',
  parse: 'PARSE',
  extract: 'PIONEER',
  sign: 'SIGN',
  conflict: 'CONFLICT',
  done: 'DONE',
  error: 'ERROR',
};

const PHASE_ORDER: ProgressEvent['phase'][] = [
  'init',
  'parse',
  'extract',
  'sign',
  'conflict',
  'done',
];

/**
 * Live-streaming ingest button for /app?ws=inazuma. Posts to
 * /api/ingest-qontext, reads the Server-Sent-Events response body, and
 * renders a progress bar + phase log so the audience can watch the
 * pipeline run in real time. Same code path as scripts/ingest-qontext.ts;
 * different transport.
 */
export function IngestQontextButton({
  reset = true,
  audit = false,
}: {
  reset?: boolean;
  audit?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [latest, setLatest] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState<ProgressEvent | null>(null);

  async function start() {
    setRunning(true);
    setEvents([]);
    setLatest(null);
    setError(null);
    setFinal(null);
    const url = `/api/ingest-qontext?reset=${reset}&audit=${audit ? 'on' : 'off'}`;
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 2);
          if (!chunk.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(chunk.slice(6)) as ProgressEvent;
            setEvents((prev) => [...prev, event]);
            setLatest(event);
            if (event.phase === 'done') setFinal(event);
            if (event.phase === 'error') setError(event.message ?? 'unknown');
          } catch {
            /* ignore malformed line */
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  const phaseIdx = latest ? PHASE_ORDER.indexOf(latest.phase) : -1;
  const progress =
    latest && latest.total && latest.total > 0
      ? Math.min(100, Math.round((100 * (latest.done ?? 0)) / latest.total))
      : null;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={running}
        onClick={start}
        className={`inline-flex h-9 min-w-[160px] items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-90 ${
          final
            ? 'bg-emerald-600 text-white hover:bg-emerald-600 dark:bg-emerald-500'
            : 'bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200'
        }`}
      >
        {running ? (
          <>
            <Spinner /> ingesting…
          </>
        ) : final ? (
          <>✓ ingested</>
        ) : (
          <>⇄ Ingest Qontext dataset</>
        )}
      </button>

      {(running || latest || error) && (
        <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:w-[28rem]">
          {/* Phase pipeline */}
          <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider">
            {PHASE_ORDER.map((p, i) => {
              const reached = phaseIdx >= i;
              const active = phaseIdx === i && !final;
              return (
                <span key={p} className="flex items-center gap-1">
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      active
                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                        : reached
                          ? 'text-zinc-700 dark:text-zinc-300'
                          : 'text-zinc-400 dark:text-zinc-600'
                    }`}
                  >
                    {PHASE_LABEL[p]}
                  </span>
                  {i < PHASE_ORDER.length - 1 && (
                    <span className="text-zinc-300 dark:text-zinc-700">›</span>
                  )}
                </span>
              );
            })}
          </div>

          {/* Progress bar */}
          {progress !== null && (
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {progress !== null && (
            <p className="mt-1 font-mono text-[10px] text-zinc-500">
              {latest?.done}/{latest?.total} · {progress}%
            </p>
          )}

          {/* Latest message */}
          {latest?.message && !final && (
            <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
              {latest.message}
            </p>
          )}

          {/* Final summary */}
          {final?.data && (
            <div className="mt-2 grid grid-cols-3 gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 dark:border-emerald-700/50 dark:bg-emerald-950/30">
              <Stat label="active" value={(final.data.active as number) ?? 0} />
              <Stat
                label="redacted"
                value={(final.data.redacted as number) ?? 0}
              />
              <Stat
                label="conflicts"
                value={(final.data.conflictsLive as number) ?? 0}
              />
              <Stat
                label="corroborated"
                value={(final.data.corroborated as number) ?? 0}
              />
              <Stat
                label="auto-resolved"
                value={(final.data.autoResolved as number) ?? 0}
              />
              <Stat
                label="duration"
                value={`${(((final.data.durationMs as number) ?? 0) / 1000).toFixed(1)}s`}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="mt-2 break-words text-xs text-rose-600 dark:text-rose-400">
              ✗ {error}
            </p>
          )}

          {/* Recent log lines */}
          {events.length > 1 && !final && (
            <details className="mt-2">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                log · {events.length} lines
              </summary>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto font-mono text-[10px] text-zinc-600 dark:text-zinc-400">
                {events.slice(-30).map((e, i) => (
                  <li key={i} className="truncate">
                    <span className="mr-1 text-zinc-400">{e.phase}</span>
                    {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-900 dark:text-emerald-100">
        {value}
      </p>
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
