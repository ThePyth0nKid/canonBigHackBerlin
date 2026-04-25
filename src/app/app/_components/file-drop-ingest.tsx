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

interface FinalStats {
  active: number;
  redacted: number;
  superseded: number;
  conflictsLive: number;
  corroborated: number;
  autoResolved: number;
  durationMs: number;
  workspace?: string;
  files?: Array<{
    filename: string;
    shape: string;
    records: number;
    drafts: number;
    chunks: number;
    error?: string;
  }>;
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
  workspace: string;
}

/**
 * Drag-and-drop / click-to-pick file uploader.
 *
 * Bundles every dropped file (single, multi, or whole-folder traversal)
 * into ONE multipart POST against /api/ingest-upload. The server runs
 * the pipeline once over the union of drafts — so the conflict pass and
 * the audit-chain extension happen exactly once, no matter how many
 * files arrived. Avoids the 306-files-=-306-conflict-passes nightmare.
 *
 * The SSE stream renders:
 *   - phase pipeline (init → parse → pioneer → sign → conflict → done)
 *   - phase-relevant progress bar (files for parse, chunks for pioneer,
 *     drafts for sign)
 *   - tail of signed facts as they land
 *   - aggregate summary + per-file table at the end
 *   - "Jump to first conflict" CTA when conflicts surface
 */
export function FileDropIngest({ workspace }: Props) {
  const router = useRouter();
  const inputFileRef = useRef<HTMLInputElement>(null);
  const inputFolderRef = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [latest, setLatest] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedFacts, setSignedFacts] = useState<SignedFact[]>([]);
  const [final, setFinal] = useState<FinalStats | null>(null);
  const phaseStartRef = useRef<{ phase: Phase | null; t: number; doneAt: number }>({
    phase: null,
    t: 0,
    doneAt: 0,
  });
  const [eta, setEta] = useState<string | null>(null);

  /**
   * Single POST with all files. The route runs the pipeline once over
   * the union of their drafts, so the audit-chain stays clean and the
   * conflict pass runs exactly once at the end.
   */
  const startUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setRunning(true);
      setFileCount(files.length);
      setLatest(null);
      setError(null);
      setSignedFacts([]);
      setFinal(null);
      setEta(null);
      phaseStartRef.current = { phase: null, t: 0, doneAt: 0 };

      const fd = new FormData();
      for (const f of files) fd.append('files', f, f.name);
      fd.append('workspace', workspace);

      let aborted = false;
      try {
        const res = await fetch('/api/ingest-upload', { method: 'POST', body: fd });
        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {
            /* fallthrough */
          }
          setError(msg);
          aborted = true;
          return;
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
              // Compute a phase-local ETA from the rate of done/total
              // progress within the current phase. Resets when phase
              // changes so each phase shows its own ETA, not the run total.
              const ref = phaseStartRef.current;
              if (event.phase !== ref.phase) {
                ref.phase = event.phase;
                ref.t = Date.now();
                ref.doneAt = event.done ?? 0;
              } else if (
                typeof event.done === 'number' &&
                typeof event.total === 'number' &&
                event.total > 0 &&
                event.done > ref.doneAt
              ) {
                const elapsed = Date.now() - ref.t;
                const ratio = (event.done - ref.doneAt) / event.total;
                if (ratio > 0.01 && elapsed > 500) {
                  const remainingRatio = (event.total - event.done) / event.total;
                  const etaMs = (elapsed / ratio) * remainingRatio;
                  setEta(formatEta(etaMs));
                }
              }
              if (event.fact) {
                const f = event.fact;
                setSignedFacts((prev) => {
                  if (prev.some((p) => p.factId === f.factId)) return prev;
                  return [...prev, f].slice(-500);
                });
              }
              if (event.phase === 'done' && event.data) {
                setFinal(event.data as unknown as FinalStats);
              }
              if (event.phase === 'error') {
                setError(event.message ?? 'unknown');
                aborted = true;
              }
            } catch {
              /* ignore malformed line */
            }
          }
        }
      } catch (e) {
        setError((e as Error).message);
        aborted = true;
      } finally {
        setRunning(false);
        if (!aborted) router.refresh();
      }
    },
    [router, workspace],
  );

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
      void startUpload(filtered);
    },
    [running, startUpload],
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
                Ingesting {fileCount} file{fileCount === 1 ? '' : 's'} —{' '}
                {latest?.phase ? PHASE_LABEL[latest.phase] : 'starting'}
              </span>
            </div>
          </>
        ) : final ? (
          <>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              ✓ Ingested {fileCount} file{fileCount === 1 ? '' : 's'} ·{' '}
              {final.active} active facts
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
      {(running || latest || error || final) && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
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

          {/* Progress bar (parse: files | extract: chunks | sign: drafts) */}
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
              {phaseLabelForUnits(latest?.phase)}: {latest?.done}/{latest?.total} ·{' '}
              {progress}%
              {eta && (
                <span className="ml-2 text-zinc-400">~{eta} remaining</span>
              )}
            </p>
          )}

          {/* Latest status message */}
          {latest?.message && running && (
            <p className="mt-2 truncate text-xs text-zinc-700 dark:text-zinc-300">
              {latest.message}
            </p>
          )}

          {/* Streaming fact rows */}
          {signedFacts.length > 0 && (
            <div className="mt-3 max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
              <ul className="divide-y divide-zinc-200 font-mono text-[11px] leading-snug dark:divide-zinc-800">
                {signedFacts.slice(-100).map((f) => (
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
                {signedFacts.length} signed event{signedFacts.length === 1 ? '' : 's'}
                {' · '}
                tail of {Math.min(signedFacts.length, 100)} shown
              </p>
            </div>
          )}

          {/* Final summary */}
          {final && (
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-700/50 dark:bg-emerald-950/30">
              <Stat label="active" value={final.active} />
              <Stat label="redacted" value={final.redacted} />
              <Stat label="conflicts" value={final.conflictsLive} />
              <Stat label="corroborated" value={final.corroborated} />
              <Stat label="auto-resolved" value={final.autoResolved} />
              <Stat
                label="duration"
                value={`${(final.durationMs / 1000).toFixed(1)}s`}
              />
            </div>
          )}

          {/* Per-file breakdown when many files were dropped */}
          {final && final.files && final.files.length > 1 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                per-file breakdown · {final.files.length} files
              </summary>
              <div className="mt-2 max-h-48 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                <table className="w-full font-mono text-[10px]">
                  <thead className="text-zinc-500">
                    <tr className="text-left">
                      <th className="pb-1">file</th>
                      <th className="pb-1">shape</th>
                      <th className="pb-1 text-right">rec</th>
                      <th className="pb-1 text-right">drafts</th>
                      <th className="pb-1 text-right">chunks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {final.files.map((f) => (
                      <tr key={f.filename} className="text-zinc-700 dark:text-zinc-300">
                        <td className="truncate pr-2">{f.filename}</td>
                        <td className="pr-2 text-zinc-500">{f.shape}</td>
                        <td className="pr-2 text-right tabular-nums">{f.records}</td>
                        <td className="pr-2 text-right tabular-nums">{f.drafts}</td>
                        <td className="text-right tabular-nums">{f.chunks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* Conflict CTA */}
          {final && final.conflictsLive > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                {final.conflictsLive} unresolved conflict
                {final.conflictsLive === 1 ? '' : 's'} need your decision —
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

function formatEta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m${r.toString().padStart(2, '0')}s`;
}

function phaseLabelForUnits(phase?: Phase): string {
  switch (phase) {
    case 'parse':
      return 'files';
    case 'extract':
      return 'chunks';
    case 'sign':
      return 'drafts';
    default:
      return '';
  }
}

/* ---------------------------------------------------------------- *
 *  Drop traversal — collect File[] from a DataTransfer that may
 *  carry plain files OR a folder (via webkitGetAsEntry).
 * ---------------------------------------------------------------- */

async function collectFromDrop(dt: DataTransfer): Promise<File[]> {
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
