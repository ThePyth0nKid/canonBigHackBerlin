/**
 * POST /api/ingest-upload — multipart file upload → live SSE ingest.
 *
 * Accepts ONE or MANY files in a single request. The browser bundles
 * all dropped files (or a whole folder traversal) into a single
 * multipart body so we run the pipeline once over the union of their
 * drafts — not N times round-tripping the whole stack.
 *
 *   Form fields:
 *     - files       — repeatable; each part is one File
 *     - workspace   — destination FactEvent.workspace tag (default 'main')
 *
 * Phases (each emitted as `data: {...}\n\n`):
 *   1. init     — total bytes / file count / workspace
 *   2. parse    — per-file parse with progress (done/total = file index)
 *   3. extract  — Pioneer over the union of free-form chunks (omitted when 0)
 *   4. sign     — per-fact signed + persisted; emits `fact` payload every event
 *   5. conflict — workspace-scoped conflict pass after persistence
 *   6. done     — aggregate stats incl. links into the resolve modal
 *
 * No reset: every upload appends. Drop additional files / folders to
 * extend the workspace and watch cross-source conflicts emerge.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractFactsFromChunks, type Chunk } from '@/lib/canon/pioneer';
import type { FactDraft } from '@/lib/canon/types';
import { CanonSigner } from '@/lib/canon/sign';
import { runPipeline } from '@/lib/canon/pipeline';
import { resolveUserConflicts } from '@/lib/canon/conflicts';
import {
  parseUploadedFile,
  type UploadParseResult,
} from '@/lib/ingest/upload';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ProgressEvent {
  phase:
    | 'init'
    | 'parse'
    | 'extract'
    | 'sign'
    | 'conflict'
    | 'done'
    | 'error';
  message?: string;
  done?: number;
  total?: number;
  data?: Record<string, unknown>;
  fact?: {
    factId: string;
    entity: string;
    claim: string;
    sourceRef: string;
    status: 'active' | 'redacted' | 'superseded';
    eventHash: string;
    notes?: string;
  };
}

const ALLOWED_WORKSPACES = new Set([
  'main',
  'inazuma',
  'northwind',
  'upload',
]);

/** Hard cap to keep one POST from over-burning the Pioneer / signer budget. */
const MAX_TOTAL_FILES = 1000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB

export async function POST(req: Request) {
  const reqStart = Date.now();
  const ctype = req.headers.get('content-type') ?? '';
  const clen = req.headers.get('content-length') ?? '?';
  console.log(
    `[ingest-upload] POST received content-length=${clen} content-type=${ctype.slice(0, 80)}`,
  );

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    console.warn('[ingest-upload] 401 unauthorized — no session');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Parse multipart up-front so we can return real 4xx for bad payloads
  // instead of swallowing the error inside an SSE stream the client may
  // not surface usefully.
  let files: File[];
  let workspace: string;
  try {
    console.log('[ingest-upload] parsing FormData…');
    const fdStart = Date.now();
    const fd = await req.formData();
    const fdMs = Date.now() - fdStart;
    const raw = fd.getAll('files');
    files = raw.filter((f): f is File => f instanceof File && f.size > 0);
    console.log(
      `[ingest-upload] FormData parsed in ${fdMs}ms · raw entries=${raw.length} · valid files=${files.length}`,
    );
    if (files.length === 0) {
      console.warn('[ingest-upload] 400 no files in FormData');
      return NextResponse.json(
        { error: 'no files received (use form field "files")' },
        { status: 400 },
      );
    }
    if (files.length > MAX_TOTAL_FILES) {
      console.warn(`[ingest-upload] 400 too many files (${files.length})`);
      return NextResponse.json(
        {
          error: `too many files (${files.length}); cap is ${MAX_TOTAL_FILES} per request`,
        },
        { status: 400 },
      );
    }
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      console.warn(
        `[ingest-upload] 413 payload too large (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`,
      );
      return NextResponse.json(
        {
          error: `payload too large (${(totalBytes / 1024 / 1024).toFixed(1)} MB); cap is ${
            MAX_TOTAL_BYTES / 1024 / 1024
          } MB per request`,
        },
        { status: 413 },
      );
    }
    const ws = (fd.get('workspace') as string | null) ?? 'main';
    if (!ALLOWED_WORKSPACES.has(ws)) {
      console.warn(`[ingest-upload] 400 bad workspace=${ws}`);
      return NextResponse.json(
        { error: `workspace must be one of: ${[...ALLOWED_WORKSPACES].join(', ')}` },
        { status: 400 },
      );
    }
    workspace = ws;
    console.log(
      `[ingest-upload] accepted user=${userId} ws=${workspace} files=${files.length} totalMB=${(totalBytes / 1024 / 1024).toFixed(1)} latencySoFar=${Date.now() - reqStart}ms`,
    );
  } catch (err) {
    console.error('[ingest-upload] multipart parse threw:', err);
    return NextResponse.json(
      { error: `multipart parse failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const skipAudit = new URL(req.url).searchParams.get('audit') !== 'on';

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: ProgressEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller closed (client disconnected) — silently drop.
        }
      };

      const t0 = Date.now();
      try {
        const totalBytes = files.reduce((s, f) => s + f.size, 0);
        console.log(
          `[ingest-upload] SSE stream opened · phase=init files=${files.length} totalMB=${(totalBytes / 1024 / 1024).toFixed(1)}`,
        );
        send({
          phase: 'init',
          message: `Receiving ${files.length} file${
            files.length === 1 ? '' : 's'
          } (${(totalBytes / 1024 / 1024).toFixed(1)} MB)…`,
          data: {
            workspace,
            fileCount: files.length,
            totalBytes,
          },
        });

        // ----- parse each file (sequential so SSE updates land in order) -----
        const allDirectDrafts: FactDraft[] = [];
        const allChunks: Chunk[] = [];
        const perFileSummary: Array<{
          filename: string;
          shape: UploadParseResult['shape'];
          records: number;
          drafts: number;
          chunks: number;
          error?: string;
        }> = [];
        send({
          phase: 'parse',
          message: `Parsing ${files.length} file${files.length === 1 ? '' : 's'}…`,
          done: 0,
          total: files.length,
        });
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          try {
            const parsed = await parseUploadedFile(f);
            allDirectDrafts.push(...parsed.directDrafts);
            allChunks.push(...parsed.pipelineChunks);
            perFileSummary.push({
              filename: f.name,
              shape: parsed.shape,
              records: parsed.recordCount,
              drafts: parsed.directDrafts.length,
              chunks: parsed.pipelineChunks.length,
            });
            send({
              phase: 'parse',
              message: `Parsed ${f.name} → ${parsed.shape} (${parsed.recordCount} records, ${parsed.directDrafts.length} drafts, ${parsed.pipelineChunks.length} chunks)`,
              done: i + 1,
              total: files.length,
            });
          } catch (e) {
            perFileSummary.push({
              filename: f.name,
              shape: 'unknown',
              records: 0,
              drafts: 0,
              chunks: 0,
              error: (e as Error).message,
            });
            send({
              phase: 'parse',
              message: `Skipped ${f.name}: ${(e as Error).message}`,
              done: i + 1,
              total: files.length,
            });
          }
        }
        send({
          phase: 'parse',
          message: `Parse done: ${allDirectDrafts.length} direct drafts + ${allChunks.length} chunks across ${files.length} file${files.length === 1 ? '' : 's'}.`,
          done: files.length,
          total: files.length,
          data: {
            files: perFileSummary,
            directDrafts: allDirectDrafts.length,
            chunks: allChunks.length,
          },
        });

        // ----- extract (Pioneer) over union of chunks -----
        let pipelineDrafts: FactDraft[] = [];
        if (allChunks.length > 0) {
          send({
            phase: 'extract',
            message: `Pioneer extracting from ${allChunks.length} chunks…`,
            done: 0,
            total: allChunks.length,
          });
          try {
            pipelineDrafts = await extractFactsFromChunks(allChunks, {
              permissive: true,
              onProgress: (ev) => {
                send({
                  phase: 'extract',
                  message: `Pioneer batch ${ev.done}/${ev.total}…`,
                  done: ev.done,
                  total: ev.total,
                });
              },
            });
          } catch (e) {
            // Pioneer down / quota — keep going with whatever direct drafts we have.
            send({
              phase: 'extract',
              message: `Pioneer error (continuing with ${allDirectDrafts.length} direct drafts): ${(e as Error).message}`,
              done: allChunks.length,
              total: allChunks.length,
            });
          }
          send({
            phase: 'extract',
            message: `Pioneer extracted ${pipelineDrafts.length} drafts from ${allChunks.length} chunks.`,
            done: allChunks.length,
            total: allChunks.length,
          });
        }

        const allDrafts = [...allDirectDrafts, ...pipelineDrafts];
        if (allDrafts.length === 0) {
          send({
            phase: 'done',
            message:
              'No facts extractable from these files. Try JSON / CSV with named records or a PDF / text file with substantive content.',
            data: {
              active: 0,
              redacted: 0,
              superseded: 0,
              conflictsLive: 0,
              corroborated: 0,
              autoResolved: 0,
              durationMs: Date.now() - t0,
              workspace,
              files: perFileSummary,
            },
          });
          controller.close();
          return;
        }
        const context = allDrafts
          .map((d) => `[${d.observedAt}] ${d.entity}: ${d.claim}`)
          .join('\n');

        // ----- sign -----
        send({
          phase: 'sign',
          message: `Signing ${allDrafts.length} facts → Ed25519 + COSE_Sign1…`,
          done: 0,
          total: allDrafts.length,
        });
        const signer = new CanonSigner();
        signer.start();
        let result;
        // Throttle the SSE flood when signing thousands of drafts: emit every
        // single one for the first 30 (so the row tail looks alive instantly)
        // then throttle to every Nth so 5000-draft uploads don't drown the
        // browser in JSON parses. We always emit the very last event so the
        // progress bar lands cleanly at 100%.
        const total = allDrafts.length;
        const stride = total <= 100 ? 1 : total <= 500 ? 3 : total <= 2000 ? 8 : 20;
        try {
          result = await runPipeline({
            userId,
            drafts: allDrafts,
            context,
            contextLabel: `Upload · ${files.length} file${files.length === 1 ? '' : 's'} · ${allDrafts.length} drafts`,
            signer,
            skipAudit,
            workspace,
            onProgress: (ev) => {
              if (ev.phase !== 'sign') return;
              const isFirstBurst = ev.done <= 30;
              const isStride = ev.done % stride === 0;
              const isLast = ev.done >= ev.total;
              if (!isFirstBurst && !isStride && !isLast) return;
              const f = ev.fact;
              send({
                phase: 'sign',
                message: `Signing ${ev.entity}…`,
                done: ev.done,
                total: ev.total,
                fact: f
                  ? {
                      factId: f.factId,
                      entity: ev.entity,
                      claim: f.claim,
                      sourceRef: f.sourceRef,
                      status: f.status,
                      eventHash: f.eventHash,
                      notes: f.notes,
                    }
                  : undefined,
              });
            },
          });
        } finally {
          await signer.close();
        }
        send({
          phase: 'sign',
          message: `Signed: active=${result.active} redacted=${result.redacted} superseded=${result.superseded}`,
          done: allDrafts.length,
          total: allDrafts.length,
          data: {
            active: result.active,
            redacted: result.redacted,
            superseded: result.superseded,
          },
        });

        // ----- conflicts (one pass over the whole workspace) -----
        send({ phase: 'conflict', message: 'Running cross-source conflict pass…' });
        const conflicts = await resolveUserConflicts(userId, workspace);
        const live = conflicts.groups.filter((g) => g.values.length > 1).length;
        const corroborated = conflicts.groups.filter(
          (g) => g.values.length === 1 && g.totalFacts >= 2,
        ).length;

        // ----- done -----
        send({
          phase: 'done',
          message: `Complete in ${((Date.now() - t0) / 1000).toFixed(1)}s.`,
          data: {
            active: result.active,
            redacted: result.redacted,
            superseded: result.superseded,
            conflictsLive: live,
            corroborated,
            autoResolved: conflicts.resolutions.length,
            durationMs: Date.now() - t0,
            workspace,
            files: perFileSummary,
          },
        });
        controller.close();
      } catch (err) {
        console.error('[ingest-upload] pipeline threw inside SSE stream:', err);
        send({
          phase: 'error',
          message: (err as Error).message ?? 'unknown error',
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
