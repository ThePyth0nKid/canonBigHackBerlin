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

interface AggregateStats {
  active: number;
  redacted: number;
  superseded: number;
  conflictsLive: number;
  corroborated: number;
  autoResolved: number;
  durationMs: number;
  files: number;
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

const ALLOWED_EXTS = ['json', 'ndjson', 'csv', 'txt', 'md', 'pdf'];

interface Props {
  workspace: 'inazuma' | 'northwind' | 'upload';
}

/**
 * Drag-and-drop / click-to-pick file uploader.
 *
 * Single-file: drop one file or pick one — runs through /api/ingest-upload
 * and renders the SSE stream live (phase pipeline, progress bar, signed
 * fact rows, final summary).
 *
 * Multi-file / folder: drop many files at once or drag a whole directory.
 * The component traverses the dropped entries via webkitGetAsEntry,
 * filters to known filetypes, and ingests them sequentially through
 * the same SSE channel. The signed-fact tail accumulates across the
 * queue so the audience sees facts compounding from many sources.
 */
export function FileDropIngest({ workspace }: Props) {
  const router = useRouter();
  const inputFileRef = useRef<HTMLInputElement>(null);
  const inputFolderRef = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [queue, setQueue] = useState<{ idx: number; total: number; name: string } | null>(
    null,
  );
  const [latest, setLatest] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedFacts, setSignedFacts] = useState<SignedFact[]>([]);
  const [agg, setAgg] = useState<AggregateStats | null>(null);
  const [finishedAll, setFinishedAll] = useState(false);

  /** Run a single file → /api/ingest-upload, fold its result into agg. */
  const ingestOne = useCallback(
    async (file: File): Promise<boolean> => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('workspace', workspace);

      const res = await fetch('/api/ingest-upload', { method: 'POST', body: fd });
      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* fallthrough */
        }
        setError(`${file.name}: ${msg}`);
        return false;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let lastDoneEvent: ProgressEvent | null = null;
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
                return [...prev, f].slice(-300);
              });
            }
            if (event.phase === 'done') lastDoneEvent = event;
            if (event.phase === 'error') {
              setError(`${file.name}: ${event.message ?? 'unknown'}`);
              return false;
            }
          } catch {
            /* ignore malformed line */
          }
        }
      }

      // Fold this file's stats into the aggregate. The resolveUserConflicts
      // pass returns a workspace-wide snapshot, so conflictsLive is the
      // CURRENT count after this file landed (not additive). Take the max
      // we've seen so the UI shows the live-now conflict count, not a sum.
      const data = (lastDoneEvent?.data ?? {}) as Partial<AggregateStats>;
      setAgg((prev) => ({
        active: (prev?.active ?? 0) + (data.active ?? 0),
        redacted: (prev?.redacted ?? 0) + (data.redacted ?? 0),
        superseded: (prev?.superseded ?? 0) + (data.superseded ?? 0),
        conflictsLive: data.conflictsLive ?? prev?.conflictsLive ?? 0,
        corroborated: data.corroborated ?? prev?.corroborated ?? 0,
        autoResolved: (prev?.autoResolved ?? 0) + (data.autoResolved ?? 0),
        durationMs: (prev?.durationMs ?? 0) + (data.durationMs ?? 0),
        files: (prev?.files ?? 0) + 1,
      }));
      return true;
    },
    [workspace],
  );

  /** Drive a queue of files through /api/ingest-upload sequentially. */
  const startQueue = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setRunning(true);
      setLatest(null);
      setError(null);
      setSignedFacts([]);
      setAgg(null);
      setFinishedAll(false);

      try {
        for (let i = 0; i < files.length; i++) {
          setQueue({ idx: i + 1, total: files.length, name: files[i].name });
          const ok = await ingestOne(files[i]);
          if (!ok) break;
        }
      } finally {
        setRunning(false);
        setFinishedAll(true);
        router.refresh();
      }
    },
    [ingestOne, router],
  );

  /** Triggered by both the file drop and the click-to-pick inputs. */
  const onIncomingFiles = useCallback(
    async (filesIn: File[]) => {
      if (running) return;
      const filtered = filesIn
        .filter((f) => f.size > 0)
        .filter((f) => extOf(f.name) && ALLOWED_EXTS.includes(extOf(f.name)!));
      if (filtered.length === 0) {
        setError(
          `No supported files found. Accepted: ${ALLOWED_EXTS.map((x) => '.' + x).join(', ')}`,
        );
        return;
      }
      void startQueue(filtered);
    },
    [running, startQueue],
  );

  const phaseIdx = latest ? PHASE_ORDER.indexOf(latest.phase) : -1;
  const progress =
    latest && latest.total && latest.total > 0
      ? Math.min(100, Math.round((100 * (latest.done ?? 0)) / latest.total))
      : null;

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
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          if (running) return;
          const files = await collectFromDrop(e.dataTransfer);
          await onIncomingFiles(files);
        }}
        className={`relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
          running
            ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30'
            : dragOver
              ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-500/10'
              : 'border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600'
        }`}
      >
        <input
          ref={inputFileRef}
          id="canon-file-input"
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          disabled={running}
          onChange={(e) => onIncomingFiles(Array.from(e.target.files ?? []))}
        />
        <input
          ref={inputFolderRef}
          type="file"
          /* @ts-expect-error — webkitdirectory is non-standard but supported. */
          webkitdirectory=""
          directory=""
          multiple
          className="sr-only"
          disabled={running}
          onChange={(e) => onIncomingFiles(Array.from(e.target.files ?? []))}
        />

        {running ? (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              <Spinner />
              <span>
                {queue ? (
                  <>
                    [{queue.idx}/{queue.total}] Ingesting{' '}
                    <span className="font-mono text-xs">{queue.name}</span>…
                  </>
                ) : (
                  <>Ingesting…</>
                )}
              </span>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
              {latest?.phase ? PHASE_LABEL[latest.phase] : 'starting'}
            </p>
          </>
        ) : finishedAll && agg ? (
          <>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              ✓ Ingested {agg.files} file{agg.files === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-zinc-500">
              Drop more files (or a folder) to extend the workspace.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              Drop files or a folder, or click to pick
            </p>
            <p className="text-xs text-zinc-500">
              JSON · NDJSON · CSV · TXT · MD · PDF — facts land in workspace{' '}
              <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                {workspace}
              </span>
            </p>
            <div className="mt-1 flex gap-2 text-[11px]">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  inputFileRef.current?.click();
                }}
                className="rounded-full border border-zinc-300 bg-white px-3 py-1 font-medium text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                Pick file(s)
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  inputFolderRef.current?.click();
                }}
                className="rounded-full border border-zinc-300 bg-white px-3 py-1 font-medium text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                Pick folder
              </button>
            </div>
          </>
        )}
      </label>

      {/* Live pipeline panel */}
      {(running || latest || error || finishedAll) && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          {/* Queue header */}
          {running && queue && queue.total > 1 && (
            <div className="mb-3 flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/40">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                queue · file {queue.idx} of {queue.total}
              </span>
              <span className="font-mono text-[10px] text-zinc-700 dark:text-zinc-300">
                {queue.name}
              </span>
            </div>
          )}

          {/* Phase pipeline */}
          <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono uppercase tracking-wider">
            {PHASE_ORDER.map((p, i) => {
              const reached = phaseIdx >= i;
              const active = phaseIdx === i && running;
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
          {progress !== null && running && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {progress !== null && running && (
            <p className="mt-1 font-mono text-[10px] text-zinc-500">
              {latest?.done}/{latest?.total} · {progress}%
            </p>
          )}

          {/* Latest status message */}
          {latest?.message && running && (
            <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
              {latest.message}
            </p>
          )}

          {/* Streaming fact rows */}
          {signedFacts.length > 0 && (
            <div className="mt-3 max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
              <ul className="divide-y divide-zinc-200 font-mono text-[11px] leading-snug dark:divide-zinc-800">
                {signedFacts.slice(-80).map((f) => (
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
              <p className="border-t border-zinc-200 bg-white px-3 py-1 font-mono text-[10px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                {signedFacts.length} signed event{signedFacts.length === 1 ? '' : 's'}{' '}
                · tail of {Math.min(signedFacts.length, 80)} shown
              </p>
            </div>
          )}

          {/* Aggregate summary (visible during + after) */}
          {agg && (
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-700/50 dark:bg-emerald-950/30">
              <Stat label="active" value={agg.active} />
              <Stat label="redacted" value={agg.redacted} />
              <Stat label="conflicts" value={agg.conflictsLive} />
              <Stat label="corroborated" value={agg.corroborated} />
              <Stat label="auto-resolved" value={agg.autoResolved} />
              <Stat
                label="duration"
                value={`${(agg.durationMs / 1000).toFixed(1)}s`}
              />
            </div>
          )}

          {/* Conflict CTA */}
          {finishedAll && agg && agg.conflictsLive > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                {agg.conflictsLive} unresolved conflict
                {agg.conflictsLive === 1 ? '' : 's'} need your decision —
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

/* ---------------------------------------------------------------- *
 *  Drop traversal — collect File[] from a DataTransfer that may
 *  carry plain files OR a folder (via webkitGetAsEntry).
 * ---------------------------------------------------------------- */

async function collectFromDrop(dt: DataTransfer): Promise<File[]> {
  // Prefer items[] when available — it exposes folder entries via
  // webkitGetAsEntry. Fall back to dt.files for older browsers / drops
  // that aren't directory-shaped.
  const out: File[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  if (items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const entries = items
      .filter((it) => it.kind === 'file')
      .map((it) => it.webkitGetAsEntry())
      .filter((e): e is FileSystemEntry => e !== null);
    for (const e of entries) await walkEntry(e, out);
    if (out.length > 0) return out;
  }
  // Fallback: plain file list.
  if (dt.files && dt.files.length > 0) {
    return Array.from(dt.files);
  }
  return out;
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    await new Promise<void>((resolve) => {
      fileEntry.file(
        (file) => {
          // Skip hidden / metadata files macOS inserts in zips and folders.
          if (!file.name.startsWith('.') && !file.name.startsWith('._')) {
            out.push(file);
          }
          resolve();
        },
        () => resolve(),
      );
    });
    return;
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    // readEntries returns batches of up to ~100 entries; loop until empty.
    while (true) {
      const batch: FileSystemEntry[] = await new Promise((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries),
          () => resolve([]),
        );
      });
      if (batch.length === 0) break;
      for (const child of batch) await walkEntry(child, out);
    }
  }
}

function extOf(name: string): string | null {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : null;
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
