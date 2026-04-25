'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'init' | 'parse' | 'extract' | 'sign' | 'conflict' | 'done' | 'error';

interface SignedFact {
  factId: string;
  entity: string;
  claim: string;
  sourceRef: string;
  status: 'active' | 'redacted' | 'superseded';
  eventHash: string;
  notes?: string;
}

interface ProgressEvent {
  phase: Phase;
  message?: string;
  done?: number;
  total?: number;
  data?: Record<string, unknown>;
  fact?: SignedFact;
}

const PHASE_LABEL: Record<Phase, string> = {
  init: 'INIT',
  parse: 'PARSE',
  extract: 'PIONEER',
  sign: 'SIGN',
  conflict: 'CONFLICT',
  done: 'DONE',
  error: 'ERROR',
};

const PHASE_ORDER: Phase[] = ['init', 'parse', 'extract', 'sign', 'conflict', 'done'];

const ACCEPT =
  '.json,.ndjson,.csv,.txt,.md,.pdf,application/json,text/csv,text/plain,application/pdf';

interface Props {
  workspace: 'inazuma' | 'northwind' | 'upload';
}

/**
 * Drag-and-drop / click-to-pick file uploader. POSTs to /api/ingest-upload
 * as multipart/form-data and consumes the SSE response. As facts get
 * signed, rows render live in a tail-style preview so the audience watches
 * the pipeline's output emerge in real time.
 */
export function FileDropIngest({ workspace }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [latest, setLatest] = useState<ProgressEvent | null>(null);
  const [final, setFinal] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedFacts, setSignedFacts] = useState<SignedFact[]>([]);

  const startUpload = useCallback(
    async (file: File) => {
      setRunning(true);
      setFilename(file.name);
      setLatest(null);
      setFinal(null);
      setError(null);
      setSignedFacts([]);

      const fd = new FormData();
      fd.append('file', file);
      fd.append('workspace', workspace);

      try {
        const res = await fetch('/api/ingest-upload', {
          method: 'POST',
          body: fd,
        });
        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {
            /* fallthrough */
          }
          throw new Error(msg);
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
              setLatest(event);
              if (event.fact) {
                const f = event.fact;
                setSignedFacts((prev) => {
                  if (prev.some((p) => p.factId === f.factId)) return prev;
                  return [...prev, f].slice(-200);
                });
              }
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
    },
    [router, workspace],
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0 || running) return;
      void startUpload(files[0]);
    },
    [running, startUpload],
  );

  const phaseIdx = latest ? PHASE_ORDER.indexOf(latest.phase) : -1;
  const progress =
    latest && latest.total && latest.total > 0
      ? Math.min(100, Math.round((100 * (latest.done ?? 0)) / latest.total))
      : null;

  const finalData = (final?.data ?? {}) as {
    active?: number;
    redacted?: number;
    superseded?: number;
    conflictsLive?: number;
    corroborated?: number;
    autoResolved?: number;
    durationMs?: number;
    workspace?: string;
  };

  return (
    <div className="flex w-full flex-col items-stretch gap-3">
      {/* Drop zone */}
      <label
        htmlFor="canon-file-input"
        onDragEnter={(e) => {
          e.preventDefault();
          if (!running) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!running) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!running) onFiles(e.dataTransfer.files);
        }}
        className={`relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
          running
            ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30'
            : dragOver
              ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-500/10'
              : 'border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600'
        }`}
      >
        <input
          ref={inputRef}
          id="canon-file-input"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={running}
          onChange={(e) => onFiles(e.target.files)}
        />

        {running ? (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              <Spinner />
              <span>
                Ingesting <span className="font-mono text-xs">{filename}</span>…
              </span>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
              {latest?.phase ? PHASE_LABEL[latest.phase] : 'starting'}
            </p>
          </>
        ) : final ? (
          <>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              ✓ {filename} ingested
            </p>
            <p className="text-xs text-zinc-500">
              Drop another file to extend the workspace, or resolve conflicts below.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              Drop a file to ingest, or click to pick one
            </p>
            <p className="text-xs text-zinc-500">
              JSON · NDJSON · CSV · TXT · MD · PDF — facts land in workspace{' '}
              <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                {workspace}
              </span>
            </p>
          </>
        )}
      </label>

      {/* Live pipeline panel */}
      {(running || latest || error || final) && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          {/* Phase pipeline */}
          <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono uppercase tracking-wider">
            {PHASE_ORDER.map((p, i) => {
              const reached = phaseIdx >= i;
              const active = phaseIdx === i && !final && !error;
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
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
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

          {/* Latest status message */}
          {latest?.message && !final && !error && (
            <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
              {latest.message}
            </p>
          )}

          {/* Streaming fact rows */}
          {signedFacts.length > 0 && (
            <div className="mt-3 max-h-64 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
              <ul className="divide-y divide-zinc-200 font-mono text-[11px] leading-snug dark:divide-zinc-800">
                {signedFacts.slice(-50).map((f) => (
                  <li
                    key={f.factId}
                    className="flex items-start gap-2 px-3 py-1.5"
                  >
                    <StatusDot status={f.status} />
                    <span className="shrink-0 text-zinc-500">{f.entity}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">
                      {f.status === 'redacted' ? '〈redacted〉' : f.claim}
                    </span>
                    <span className="shrink-0 text-zinc-400">
                      {f.eventHash.slice(0, 8)}…
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Final summary */}
          {final && (
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-700/50 dark:bg-emerald-950/30">
              <Stat label="active" value={finalData.active ?? 0} />
              <Stat label="redacted" value={finalData.redacted ?? 0} />
              <Stat label="conflicts" value={finalData.conflictsLive ?? 0} />
              <Stat label="corroborated" value={finalData.corroborated ?? 0} />
              <Stat label="auto-resolved" value={finalData.autoResolved ?? 0} />
              <Stat
                label="duration"
                value={`${((finalData.durationMs ?? 0) / 1000).toFixed(1)}s`}
              />
            </div>
          )}

          {/* Conflict CTA */}
          {final && (finalData.conflictsLive ?? 0) > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                {finalData.conflictsLive} unresolved conflict
                {finalData.conflictsLive === 1 ? '' : 's'} need your decision —
                scroll down to resolve.
              </p>
              <button
                type="button"
                className="rounded-full bg-amber-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
                onClick={() => {
                  document
                    .querySelector('[data-conflict-anchor]')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                Jump to first
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="mt-2 break-words text-xs text-rose-600 dark:text-rose-400">
              ✗ {error}
            </p>
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

function StatusDot({ status }: { status: SignedFact['status'] }) {
  const color =
    status === 'active'
      ? 'bg-emerald-500'
      : status === 'redacted'
        ? 'bg-rose-500'
        : 'bg-amber-500';
  return (
    <span
      aria-hidden
      className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`}
      title={status}
    />
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
