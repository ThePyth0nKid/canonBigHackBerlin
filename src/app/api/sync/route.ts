/**
 * POST /api/sync — the live ingest button.
 *
 * Loads every source adapter, feeds drafts through the Trust Pipeline
 * (audit + scan + sign + persist), then resolves conflicts. Returns
 * a small summary the UI can flash on the button.
 *
 * One CanonSigner subprocess for the whole run — guarantees a single
 * hash chain across sources.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { ingestSlackChannel } from '@/lib/ingest/slack';
import { ingestPdf } from '@/lib/ingest/pdf';
import { ingestGmail } from '@/lib/ingest/gmail';
import { CanonSigner } from '@/lib/canon/sign';
import { runPipeline } from '@/lib/canon/pipeline';
import { resolveUserConflicts } from '@/lib/canon/conflicts';
import type { FactDraft } from '@/lib/canon/types';

interface SyncSummary {
  sources: Array<{
    label: 'slack' | 'gmail' | 'pdf';
    drafts: number;
    active: number;
    redacted: number;
    superseded: number;
    error?: string;
  }>;
  conflicts: number;
  corroborated: number;
  resolved: number;
  totalActive: number;
  /** Optional toggle so the demo can run quickly. */
  auditSkipped: boolean;
  durationMs: number;
}

export async function POST(req: Request) {
  try {
    return await runSync(req);
  } catch (e) {
    console.error('[/api/sync] unhandled', e);
    return NextResponse.json(
      { error: 'sync_failed', message: (e as Error).message ?? String(e) },
      { status: 500 },
    );
  }
}

async function runSync(req: Request): Promise<Response> {
  const t0 = Date.now();
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const skipAudit = url.searchParams.get('audit') === 'off';
  // Post-pivot: synthetic Slack/Gmail/PDF lands alongside the Qontext
  // dataset in the unified `inazuma` workspace. The chain stays one
  // chain; multiple source kinds, one canonical view.
  const workspace = 'inazuma';

  // Capture the cutoff BEFORE any new signing happens. We never delete first —
  // if mid-sync something fails, the old chain is still intact for /app to
  // render. Old facts get cleared only AFTER at least one source successfully
  // produces fresh signed events (signedAt > t0). The prune below is also
  // scoped by sourceRef prefix so the Qontext dataset facts are never touched.
  const syncStartedAt = new Date(t0);

  const sources: SyncSummary['sources'] = [];
  const signer = new CanonSigner();
  signer.start();

  try {
    sources.push(await runSource('slack', userId, signer, skipAudit, workspace, async () => {
      const r = await ingestSlackChannel();
      return {
        drafts: r.drafts,
        context: r.drafts.map((d) => `[${d.observedAt}] ${d.claim}`).join('\n'),
        contextLabel: `Slack #sales (${r.messageCount} messages)`,
      };
    }));

    sources.push(await runSource('pdf', userId, signer, skipAudit, workspace, async () => {
      const r = await ingestPdf();
      return {
        drafts: r.drafts,
        context: r.drafts.map((d) => `[${d.sourceRef}] ${d.claim}`).join('\n'),
        contextLabel: `Q1 board deck (${r.pageCount} pages)`,
      };
    }));

    sources.push(await runSource('gmail', userId, signer, skipAudit, workspace, async () => {
      const acct = await prisma.account.findFirst({
        where: { userId, provider: 'google', access_token: { not: null } },
        orderBy: { id: 'desc' },
      });
      if (!acct) throw new Error('no Google account on user — sign in again');
      const r = await ingestGmail({
        accessToken: acct.access_token!,
        refreshToken: acct.refresh_token,
        expiresAt: acct.expires_at,
      });
      if (r.refreshedAccessToken) {
        await prisma.account.update({
          where: { id: acct.id },
          data: {
            access_token: r.refreshedAccessToken,
            expires_at: r.refreshedExpiresAt ?? acct.expires_at,
          },
        });
      }
      return {
        drafts: r.drafts,
        context: r.drafts.map((d) => `[${d.observedAt}] ${d.claim}`).join('\n'),
        contextLabel: `Gmail [canon-demo] inbox (${r.messageCount} emails)`,
      };
    }));
  } finally {
    await signer.close();
  }

  // Now that fresh facts are persisted, drop the pre-sync slack/gmail/pdf
  // chain — but ONLY if we actually have new ones to replace them, AND
  // ONLY for the synthetic source kinds. The Qontext dataset facts in the
  // same workspace are never touched here.
  const freshCount = await prisma.factEvent.count({
    where: {
      userId,
      workspace,
      signedAt: { gte: syncStartedAt },
      OR: [
        { sourceRef: { startsWith: 'slack:' } },
        { sourceRef: { startsWith: 'gmail:' } },
        { sourceRef: { startsWith: 'pdf:' } },
      ],
    },
  });
  if (freshCount > 0) {
    await prisma.factEvent.deleteMany({
      where: {
        userId,
        workspace,
        signedAt: { lt: syncStartedAt },
        OR: [
          { sourceRef: { startsWith: 'slack:' } },
          { sourceRef: { startsWith: 'gmail:' } },
          { sourceRef: { startsWith: 'pdf:' } },
        ],
      },
    });
  }

  const conflictPass = await resolveUserConflicts(userId, workspace);
  const conflicts = conflictPass.groups.filter((g) => g.values.length > 1).length;
  const corroborated = conflictPass.groups.filter(
    (g) => g.values.length === 1 && g.totalFacts >= 2,
  ).length;

  const totalActive = await prisma.factEvent.count({
    where: { userId, workspace, status: 'active' },
  });

  const summary: SyncSummary = {
    sources,
    conflicts,
    corroborated,
    resolved: conflictPass.resolutions.length,
    totalActive,
    auditSkipped: skipAudit,
    durationMs: Date.now() - t0,
  };
  return NextResponse.json(summary);
}

async function runSource(
  label: 'slack' | 'gmail' | 'pdf',
  userId: string,
  signer: CanonSigner,
  skipAudit: boolean,
  workspace: string,
  load: () => Promise<{ drafts: FactDraft[]; context: string; contextLabel: string }>,
): Promise<SyncSummary['sources'][number]> {
  try {
    const { drafts, context, contextLabel } = await load();
    const result = await runPipeline({
      userId,
      drafts,
      context,
      contextLabel,
      signer,
      skipAudit,
      workspace,
    });
    return {
      label,
      drafts: drafts.length,
      active: result.active,
      redacted: result.redacted,
      superseded: result.superseded,
    };
  } catch (e) {
    console.error(`[/api/sync] ${label} adapter failed`, e);
    return {
      label,
      drafts: 0,
      active: 0,
      redacted: 0,
      superseded: 0,
      error: (e as Error).message,
    };
  }
}
