/**
 * Block A smoke: runs all 3 source adapters end-to-end against real demo data.
 * Prints per-source counts and a unified FactDraft list.
 *
 * Usage: npx tsx scripts/ingest-smoke.ts
 */

import 'dotenv/config';
import { ingestSlackChannel } from '../src/lib/ingest/slack';
import { ingestPdf } from '../src/lib/ingest/pdf';
import { ingestGmail } from '../src/lib/ingest/gmail';
import { prisma } from '../src/lib/prisma';

const EXPECTED = 12;

function fmt(label, value, color = '\x1b[36m') {
  return `${color}${label}\x1b[0m=${value}`;
}

function summarizeDrafts(drafts) {
  const byEntity = {};
  for (const d of drafts) {
    byEntity[d.entity] = (byEntity[d.entity] ?? 0) + 1;
  }
  return byEntity;
}

async function loadGoogleAccount() {
  const account = await prisma.account.findFirst({
    where: { provider: 'google', access_token: { not: null } },
    orderBy: { id: 'desc' },
  });
  return account;
}

async function main() {
  console.log('\n=== Canon Block A · ingest smoke ===\n');

  const slow = (label, fn) =>
    fn().then(
      (r) => ({ label, ok: true, ...r }),
      (e) => ({ label, ok: false, error: e?.message ?? String(e) }),
    );

  // Slack
  const slackP = slow('slack', () => ingestSlackChannel());

  // PDF
  const pdfP = slow('pdf', () => ingestPdf());

  // Gmail (only if a Google Account row exists)
  const account = await loadGoogleAccount();
  const gmailP = account
    ? slow('gmail', async () => {
        const r = await ingestGmail({
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        });
        if (r.refreshedAccessToken) {
          await prisma.account.update({
            where: { id: account.id },
            data: {
              access_token: r.refreshedAccessToken,
              expires_at: r.refreshedExpiresAt ?? account.expires_at,
            },
          });
        }
        return r;
      })
    : Promise.resolve({
        label: 'gmail',
        ok: false,
        error: 'no Google account in DB — sign in via /login first',
      });

  const [slack, pdf, gmail] = await Promise.all([slackP, pdfP, gmailP]);

  for (const r of [slack, pdf, gmail]) {
    if (!r.ok) {
      console.log(`✗ ${r.label.padEnd(6)} failed: ${r.error}`);
      continue;
    }
    const counts = summarizeDrafts(r.drafts);
    const meta =
      r.label === 'slack'
        ? `messages=${r.messageCount}`
        : r.label === 'pdf'
          ? `pages=${r.pageCount}`
          : `messages=${r.messageCount}`;
    const tag = Object.entries(counts)
      .map(([e, n]) => `${e}=${n}`)
      .join(' ');
    console.log(
      `✓ ${r.label.padEnd(6)} ${meta.padEnd(14)} drafts=${r.drafts.length}  ${tag}`,
    );
  }

  const all = []
    .concat(slack.ok ? slack.drafts : [])
    .concat(pdf.ok ? pdf.drafts : [])
    .concat(gmail.ok ? gmail.drafts : []);

  console.log(
    `\n${fmt('total', all.length)}  ${fmt('expected', `~${EXPECTED}`, '\x1b[90m')}\n`,
  );

  if (all.length > 0) {
    console.log('--- sample drafts ---');
    for (const d of all.slice(0, 8)) {
      const m = d.metric ? ` [${d.metric.key}=${d.metric.value}${d.metric.unit ?? ''}]` : '';
      console.log(`  ${d.entity.padEnd(10)} ${d.claim.slice(0, 90)}${m}`);
      console.log(`    ↳ ${d.sourceRef}  @ ${d.observedAt}`);
    }
    if (all.length > 8) console.log(`  ... +${all.length - 8} more`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
