/**
 * POST /api/ingest-upload — multipart file upload → live SSE ingest.
 *
 * The user drags-and-drops (or picks) a file in /app. Browser POSTs it
 * here as multipart/form-data with two parts:
 *   - file:      the actual file
 *   - workspace: the FactEvent.workspace tag to land the facts under
 *                (default: "inazuma" — the demo target)
 *
 * Phases (each emitted as `data: {...}\n\n`):
 *   1. init     — workspace resolution, capacity check
 *   2. parse    — file → drafts/chunks via the upload router
 *   3. extract  — Pioneer over free-form chunks (omitted when 0)
 *   4. sign     — per-fact signed + persisted; emits a `fact` payload
 *                 every event so the UI can render streaming rows
 *   5. conflict — workspace-scoped conflict pass after persistence
 *   6. done     — summary stats incl. links into the resolve modal
 *
 * No reset: every upload appends. The user can drop multiple files
 * back-to-back to demonstrate cross-source conflict emergence.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractFactsFromChunks } from '@/lib/canon/pioneer';
import { CanonSigner } from '@/lib/canon/sign';
import { runPipeline } from '@/lib/canon/pipeline';
import { resolveUserConflicts } from '@/lib/canon/conflicts';
import { parseUploadedFile } from '@/lib/ingest/upload';

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

const ALLOWED_WORKSPACES = new Set(['inazuma', 'northwind', 'upload']);

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Pre-validate the multipart payload BEFORE opening the SSE stream so
  // we can return a real HTTP 4xx instead of a swallowed in-stream error.
  let file: File;
  let workspace: string;
  try {
    const fd = await req.formData();
    const f = fd.get('file');
    if (!(f instanceof File) || f.size === 0) {
      return NextResponse.json({ error: 'missing file' }, { status: 400 });
    }
    file = f;
    const ws = (fd.get('workspace') as string | null) ?? 'inazuma';
    if (!ALLOWED_WORKSPACES.has(ws)) {
      return NextResponse.json(
        { error: `workspace must be one of: ${[...ALLOWED_WORKSPACES].join(', ')}` },
        { status: 400 },
      );
    }
    workspace = ws;
  } catch (err) {
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
          // controller closed already (client disconnected) — ignore
        }
      };

      const t0 = Date.now();
      try {
        send({
          phase: 'init',
          message: `Receiving ${file.name} (${(file.size / 1024).toFixed(1)} KB)…`,
          data: {
            filename: file.name,
            size: file.size,
            workspace,
          },
        });

        // ----- parse -----
        send({ phase: 'parse', message: 'Detecting filetype + record shape…' });
        const parsed = await parseUploadedFile(file);
        send({
          phase: 'parse',
          message: `Detected ${parsed.shape} (${parsed.recordCount} records).`,
          data: {
            filetype: parsed.filetype,
            shape: parsed.shape,
            records: parsed.recordCount,
            directDrafts: parsed.directDrafts.length,
            pipelineChunks: parsed.pipelineChunks.length,
          },
        });

        // ----- extract (Pioneer) -----
        let pipelineDrafts: typeof parsed.directDrafts = [];
        if (parsed.pipelineChunks.length > 0) {
          send({
            phase: 'extract',
            message: `Pioneer extracting from ${parsed.pipelineChunks.length} chunks…`,
            done: 0,
            total: parsed.pipelineChunks.length,
          });
          pipelineDrafts = await extractFactsFromChunks(parsed.pipelineChunks);
          send({
            phase: 'extract',
            message: `Pioneer extracted ${pipelineDrafts.length} drafts from ${parsed.pipelineChunks.length} chunks.`,
            done: parsed.pipelineChunks.length,
            total: parsed.pipelineChunks.length,
          });
        }

        const allDrafts = [...parsed.directDrafts, ...pipelineDrafts];
        if (allDrafts.length === 0) {
          send({
            phase: 'done',
            message:
              'No facts extractable from this file. Try a JSON / CSV with named records, or a PDF / text file with substantive content.',
            data: {
              active: 0,
              redacted: 0,
              superseded: 0,
              conflictsLive: 0,
              corroborated: 0,
              autoResolved: 0,
              durationMs: Date.now() - t0,
              workspace,
              filename: file.name,
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
        try {
          result = await runPipeline({
            userId,
            drafts: allDrafts,
            context,
            contextLabel: `Upload · ${file.name} · ${allDrafts.length} drafts`,
            signer,
            skipAudit,
            workspace,
            onProgress: (ev) => {
              if (ev.phase !== 'sign') return;
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

        // ----- conflicts -----
        send({ phase: 'conflict', message: 'Running per-workspace conflict pass…' });
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
            filename: file.name,
          },
        });
        controller.close();
      } catch (err) {
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
