/**
 * POST /api/ingest-qontext — live ingest of the Qontext-supplied
 * Inazuma dataset, streamed as Server-Sent Events so the UI can show
 * a real-time progress bar.
 *
 * Flow:
 *   1. parse — reads the JSON files + walks Policy_Documents/*.pdf
 *   2. extract — runs free-form chunks through Pioneer (batched)
 *   3. sign — feeds drafts through scan → audit → canon-signer → DB
 *   4. conflict — runs the workspace-scoped conflict pass
 *   5. done — final stats
 *
 * Each phase emits a `data: {...}\n\n` line. The client reads them
 * via fetch + ReadableStream (no native EventSource — POST doesn't
 * play with EventSource cleanly).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { loadQontextSample } from '@/lib/ingest/qontext';
import { extractFactsFromChunks } from '@/lib/canon/pioneer';
import { CanonSigner } from '@/lib/canon/sign';
import { runPipeline } from '@/lib/canon/pipeline';
import { resolveUserConflicts } from '@/lib/canon/conflicts';

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
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const skipAudit = url.searchParams.get('audit') !== 'on';
  const reset = url.searchParams.get('reset') === 'true';

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
        send({ phase: 'init', message: 'Resolving demo workspace…' });

        if (reset) {
          const r = await prisma.factEvent.deleteMany({
            where: { userId, workspace: 'inazuma' },
          });
          send({
            phase: 'init',
            message: `Reset: cleared ${r.count} prior Inazuma facts.`,
          });
        }

        // ----- parse -----
        send({ phase: 'parse', message: 'Reading Qontext JSON + policy PDFs…' });
        const sample = await loadQontextSample();
        send({
          phase: 'parse',
          message: `Loaded ${sample.directDrafts.length} structured drafts + ${sample.pipelineChunks.length} text chunks.`,
          data: sample.counts,
        });

        // ----- extract (Pioneer) -----
        let pipelineDrafts: typeof sample.directDrafts = [];
        if (sample.pipelineChunks.length > 0) {
          send({
            phase: 'extract',
            message: `Pioneer extracting from ${sample.pipelineChunks.length} chunks…`,
            done: 0,
            total: sample.pipelineChunks.length,
          });
          pipelineDrafts = await extractFactsFromChunks(sample.pipelineChunks);
          send({
            phase: 'extract',
            message: `Pioneer extracted ${pipelineDrafts.length} drafts.`,
            done: sample.pipelineChunks.length,
            total: sample.pipelineChunks.length,
          });
        }

        const allDrafts = [...sample.directDrafts, ...pipelineDrafts];
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
        let lastEmit = 0;
        let result;
        try {
          result = await runPipeline({
            userId,
            drafts: allDrafts,
            context,
            contextLabel: `Qontext sample · ${allDrafts.length} drafts`,
            signer,
            skipAudit,
            workspace: 'inazuma',
            onProgress: (ev) => {
              if (ev.phase !== 'sign') return;
              // throttle: emit every 10 facts so the UI doesn't drown
              if (ev.done - lastEmit < 10 && ev.done < ev.total) return;
              lastEmit = ev.done;
              send({
                phase: 'sign',
                message: `Signing ${ev.entity}…`,
                done: ev.done,
                total: ev.total,
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
        const conflicts = await resolveUserConflicts(userId, 'inazuma');
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
