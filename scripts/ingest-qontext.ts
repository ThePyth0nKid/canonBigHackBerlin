/**
 * Ingest a sample of Qontext's simulated enterprise dataset (Inazuma.co)
 * through Canon's full Trust Pipeline. Demonstrates that the same scan→
 * audit→sign→persist code path that ingests Northwind also ingests the
 * Qontext-provided dataset. Same FactDraft contract, same hash chain.
 *
 * Usage:
 *   npx tsx scripts/ingest-qontext.ts                # default sample sizes
 *   npx tsx scripts/ingest-qontext.ts --no-audit     # skip Gemini layer
 *   npx tsx scripts/ingest-qontext.ts --reset        # clear prior facts first
 */

import 'dotenv/config';
import { loadQontextSample } from '../src/lib/ingest/qontext';
import { extractFactsFromChunks } from '../src/lib/canon/pioneer';
import { CanonSigner } from '../src/lib/canon/sign';
import { runPipeline } from '../src/lib/canon/pipeline';
import { resolveUserConflicts } from '../src/lib/canon/conflicts';
import { prisma } from '../src/lib/prisma';

const skipAudit = process.argv.includes('--no-audit');
const reset = process.argv.includes('--reset');

async function main() {
  console.log('\n=== Canon · Qontext-dataset sample ingest ===\n');

  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!user) throw new Error('no users in DB — sign in via /login first');
  console.log(`user: ${user.email ?? user.id}`);

  if (reset) {
    const r = await prisma.factEvent.deleteMany({ where: { userId: user.id } });
    console.log(`(reset: cleared ${r.count} prior FactEvents)\n`);
  }

  const t0 = Date.now();
  const sample = await loadQontextSample();
  console.log('loaded sample:', sample.counts);
  console.log(
    `direct drafts (structured ingest, no Pioneer): ${sample.directDrafts.length}`,
  );
  console.log(
    `pipeline chunks (will run through Pioneer):    ${sample.pipelineChunks.length}`,
  );
  console.log('');

  // 1. Run Pioneer over the chunks (emails + conversations) → FactDrafts.
  console.log('extracting via Pioneer …');
  const pipelineDrafts = await extractFactsFromChunks(sample.pipelineChunks);
  console.log(`Pioneer extracted ${pipelineDrafts.length} drafts from chunks.`);
  console.log('');

  // Combine for the pipeline run.
  const allDrafts = [...sample.directDrafts, ...pipelineDrafts];
  console.log(`total Qontext drafts to sign: ${allDrafts.length}\n`);

  // 2. Run them through scan → audit → sign → persist (same pipeline as
  //    Slack/Gmail/PDF — no special path).
  const signer = new CanonSigner();
  signer.start();
  const context = sample.directDrafts
    .concat(pipelineDrafts)
    .map((d) => `[${d.observedAt}] ${d.entity}: ${d.claim}`)
    .join('\n');

  const result = await runPipeline({
    userId: user.id,
    drafts: allDrafts,
    context,
    contextLabel: `Qontext sample (Inazuma.co · ${allDrafts.length} drafts)`,
    signer,
    skipAudit,
  });
  await signer.close();

  console.log(
    `pipeline: active=${result.active}  redacted=${result.redacted}  superseded=${result.superseded}\n`,
  );

  // 3. Conflict pass — clusters Qontext entities the same way as Northwind.
  const conflicts = await resolveUserConflicts(user.id);
  const trueConflicts = conflicts.groups.filter((g) => g.values.length > 1);
  const corroborated = conflicts.groups.filter(
    (g) => g.values.length === 1 && g.totalFacts >= 2,
  );

  console.log(
    `conflict pass: groups=${conflicts.groups.length}, conflicts=${trueConflicts.length}, corroborated=${corroborated.length}, resolutions=${conflicts.resolutions.length}\n`,
  );
  for (const c of corroborated.slice(0, 5)) {
    const v = c.values[0];
    console.log(
      `  ✓ ${c.entity}.${c.metricKey} = ${v.displayValue}  (corroborated by ${v.sources.join(',')}, ${c.totalFacts} facts)`,
    );
  }

  // 4. Tally — how many Qontext entities ended up in the ledger?
  const qontextEntities = await prisma.factEvent.groupBy({
    by: ['entity'],
    where: {
      userId: user.id,
      sourceRef: { startsWith: 'qontext:' },
    },
    _count: { _all: true },
  });
  const totalActive = await prisma.factEvent.count({
    where: { userId: user.id, status: 'active' },
  });

  console.log(
    `\nworkspace total active facts: ${totalActive}` +
      `  (Qontext entities: ${qontextEntities.length})`,
  );
  for (const e of qontextEntities.slice(0, 12)) {
    console.log(`  ${e.entity.padEnd(28)} ${e._count._all} facts`);
  }
  if (qontextEntities.length > 12) {
    console.log(`  ... +${qontextEntities.length - 12} more`);
  }

  console.log(`\nelapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
