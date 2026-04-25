/**
 * Block B end-to-end sync smoke.
 *
 * adapters → pipeline (audit + scan + sign + persist) → conflict resolution.
 * Prints the FactEvent landscape and a per-entity / per-metric summary.
 *
 * Usage: npx tsx scripts/sync-smoke.ts [--no-audit]   (--no-audit skips Gemini)
 *
 * Run after `/login` so a Google Account row exists for Gmail. The script
 * picks the most recently-created User as the demo identity.
 */

import 'dotenv/config';
import { ingestSlackChannel } from '../src/lib/ingest/slack';
import { ingestPdf } from '../src/lib/ingest/pdf';
import { ingestGmail } from '../src/lib/ingest/gmail';
import { CanonSigner } from '../src/lib/canon/sign';
import { runPipeline } from '../src/lib/canon/pipeline';
import { resolveUserConflicts } from '../src/lib/canon/conflicts';
import { getRepoBanner } from '../src/lib/canon/aikido';
import { prisma } from '../src/lib/prisma';

const skipAudit = process.argv.includes('--no-audit');

interface SourceRun {
  label: string;
  contextLabel: string;
  context: string;
  drafts: Awaited<ReturnType<typeof ingestSlackChannel>>['drafts'];
}

async function loadDemoUser(): Promise<{ id: string; email: string | null }> {
  const u = await prisma.user.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!u) throw new Error('no users in DB — sign in via /login first');
  return u;
}

async function loadSlackContext(): Promise<SourceRun> {
  const r = await ingestSlackChannel();
  // Gemini auditor wants the human-readable form; reconstruct from drafts.
  const ctx = r.drafts.map((d) => `[${d.observedAt}] ${d.claim}`).join('\n');
  return {
    label: 'slack',
    contextLabel: `Slack #sales (${r.messageCount} messages)`,
    context: ctx,
    drafts: r.drafts,
  };
}

async function loadPdfContext(): Promise<SourceRun> {
  const r = await ingestPdf();
  const ctx = r.drafts.map((d) => `[p${d.sourceRef.split('p')[1] ?? ''}] ${d.claim}`).join('\n');
  return {
    label: 'pdf',
    contextLabel: `Q1 Board Deck (${r.pageCount} pages)`,
    context: ctx,
    drafts: r.drafts,
  };
}

async function loadGmailContext(): Promise<SourceRun> {
  const acct = await prisma.account.findFirst({
    where: { provider: 'google', access_token: { not: null } },
    orderBy: { id: 'desc' },
  });
  if (!acct) throw new Error('no Google account in DB — sign in via /login first');
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
  const ctx = r.drafts.map((d) => `[${d.observedAt}] ${d.claim}`).join('\n');
  return {
    label: 'gmail',
    contextLabel: `Gmail [canon-demo] inbox (${r.messageCount} emails)`,
    context: ctx,
    drafts: r.drafts,
  };
}

async function main() {
  console.log('\n=== Canon Block B · sync smoke ===');
  if (skipAudit) console.log('(audit skipped — --no-audit)\n');
  else console.log('');

  const user = await loadDemoUser();
  console.log(`user: ${user.email ?? user.id}`);

  // Wipe prior runs so the chain has a clean genesis. Keeps the smoke
  // idempotent without contaminating the existing user's prod ledger.
  const cleared = await prisma.factEvent.deleteMany({ where: { userId: user.id } });
  if (cleared.count > 0) console.log(`(cleared ${cleared.count} prior FactEvents)\n`);
  else console.log('');

  const sources = await Promise.all([
    loadSlackContext(),
    loadPdfContext(),
    loadGmailContext().catch((e) => {
      console.log(`✗ gmail context: ${e.message}`);
      return null;
    }),
  ]);

  const signer = new CanonSigner();
  signer.start();

  const runs: { label: string; result: Awaited<ReturnType<typeof runPipeline>> }[] = [];
  try {
    for (const src of sources) {
      if (!src) continue;
      console.log(`→ ${src.label}: ${src.drafts.length} drafts`);
      const result = await runPipeline({
        userId: user.id,
        drafts: src.drafts,
        context: src.context,
        contextLabel: src.contextLabel,
        signer,
        skipAudit,
      });
      runs.push({ label: src.label, result });
      console.log(
        `  ✓ active=${result.active}  redacted=${result.redacted}  superseded=${result.superseded}`,
      );
    }
  } finally {
    await signer.close();
  }

  console.log('\n=== conflict pass ===');
  const conflicts = await resolveUserConflicts(user.id);
  const trueConflicts = conflicts.groups.filter((g) => g.values.length > 1);
  const corroborated = conflicts.groups.filter((g) => g.values.length === 1);
  console.log(`groups: ${conflicts.groups.length}  conflicts: ${trueConflicts.length}  corroborated: ${corroborated.length}  resolutions: ${conflicts.resolutions.length}`);

  for (const c of trueConflicts) {
    console.log(`  ⚠ ${c.entity}.${c.metricKey}:`);
    for (const v of c.values) {
      console.log(`     · ${v.displayValue.padEnd(14)} sources=${v.sources.join(',')}  facts=${v.factIds.length}  latest=${v.latestObservedAt?.toISOString().slice(0, 10) ?? 'n/a'}`);
    }
  }
  for (const c of corroborated) {
    if (c.totalFacts < 2) continue;
    const v = c.values[0];
    console.log(`  ✓ ${c.entity}.${c.metricKey} = ${v.displayValue}  (corroborated by ${v.sources.join('+')}, ${c.totalFacts} facts)`);
  }
  for (const r of conflicts.resolutions) {
    console.log(`  ⤴ resolved ${r.entity}.${r.metricKey} → ${r.winnerValue} via ${r.reason}; superseded ${r.supersededFactIds.length}`);
  }

  console.log('\n=== Aikido repo banner ===');
  try {
    const banner = await getRepoBanner();
    console.log(`  ${banner.workspaceName} · ${banner.repoName} · active=${banner.repoActive}  issues=${banner.totalIssues} (${banner.criticalIssues} critical)  fetched=${banner.fetchedAt}`);
  } catch (e: any) {
    console.log(`  ✗ ${e?.message ?? e}`);
  }

  const tally = await prisma.factEvent.groupBy({
    by: ['status'],
    where: { userId: user.id },
    _count: { _all: true },
  });
  const totals = Object.fromEntries(tally.map((t) => [t.status, t._count._all]));
  console.log(
    `\nFactEvent total: ${tally.reduce((a, t) => a + t._count._all, 0)}  ` +
      `active=${totals.active ?? 0} redacted=${totals.redacted ?? 0} superseded=${totals.superseded ?? 0}`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
