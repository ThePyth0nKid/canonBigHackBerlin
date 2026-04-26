#!/usr/bin/env -S npx tsx
/**
 * E2E smoke for Canon MCP v0.2 (write/conflicts/resolve).
 *
 * Hits the LIVE database via the same code paths the MCP tools use.
 * - Read-only: counts, conflicts query
 * - Write: ONE signed FactEvent with entity slug "_smoke_e2e_<ts>" so it
 *   doesn't pollute real demo data
 * - Read-back: canon_cite-equivalent verification of the just-written fact
 *
 * No actual conflict resolution is exercised — that requires picking one
 * of the user's real conflicts as the winner, which would mutate demo state.
 * The resolve.ts lib types are validated at compile time + the underlying
 * code path is identical to the existing UI-server-action which is already
 * production-tested.
 */
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '..', '.env'), quiet: true });
loadDotenv({ path: resolve(__dirname, '..', '.env.local'), override: true, quiet: true });

import { prisma } from '../src/lib/prisma';
import { runPipeline } from '../src/lib/canon/pipeline';
import { resolveCanonical, resolveDistinct } from '../src/lib/canon/resolve';

const SEP = '─'.repeat(60);

function ok(msg: string) {
  console.log(`✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(SEP);
  console.log('Canon MCP v0.2 — E2E smoke');
  console.log(SEP);

  // --- Stage 1: imports + DB ---
  ok('imports resolved (runPipeline, resolveCanonical, resolveDistinct)');

  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!user) fail('no users in DB');
  ok(`DB connected; demo userId=${user.id.slice(0, 8)}…`);

  const totalActive = await prisma.factEvent.count({
    where: { userId: user.id, workspace: 'inazuma', status: 'active' },
  });
  ok(`inazuma active facts: ${totalActive}`);

  // --- Stage 2: canon_conflicts logic (read-only) ---
  const facts = await prisma.factEvent.findMany({
    where: {
      userId: user.id,
      workspace: 'inazuma',
      status: 'active',
      metricKey: { not: null },
    },
    select: { entity: true, metricKey: true, metricValue: true, id: true },
  });
  const groups = new Map<string, Map<string, string[]>>();
  for (const f of facts) {
    if (!f.metricKey) continue;
    const k = `${f.entity}::${f.metricKey}`;
    if (!groups.has(k)) groups.set(k, new Map());
    const v = (f.metricValue ?? '').toLowerCase().replace(/[\s,€$£¥]/g, '').trim();
    if (!v) continue;
    if (!groups.get(k)!.has(v)) groups.get(k)!.set(v, []);
    groups.get(k)!.get(v)!.push(f.id);
  }
  const openConflicts = [...groups.entries()].filter(([, vmap]) => vmap.size >= 2);
  ok(`canon_conflicts: ${openConflicts.length} open (entity, metric) groups with ≥2 distinct values`);
  if (openConflicts.length > 0) {
    const sample = openConflicts.slice(0, 3);
    for (const [k, vmap] of sample) {
      const [entity, metricKey] = k.split('::');
      const values = [...vmap.entries()].map(([v, ids]) => `${v}(${ids.length})`).join(', ');
      console.log(`    ${entity} · ${metricKey} → ${values}`);
    }
  }

  // --- Stage 3: canon_write — REAL signed write through runPipeline ---
  const ts = new Date().toISOString();
  const testEntity = `_smoke_e2e_${Date.now()}`;
  console.log(SEP);
  console.log(`canon_write — signing test fact to entity ${testEntity}`);

  const writeResult = await runPipeline({
    userId: user.id,
    workspace: 'inazuma',
    contextLabel: `smoke-test:${testEntity}`,
    context: 'E2E smoke test - ignore in demo',
    skipAudit: true,
    drafts: [
      {
        entity: testEntity,
        claim: `E2E smoke test fact written at ${ts}`,
        sourceRef: `manual:smoke-test:${ts}`,
        sourceExcerpt: 'This is an automated smoke test fact - safe to ignore.',
        observedAt: ts,
      },
    ],
  });
  const outcome = writeResult.outcomes[0];
  if (!outcome) fail('runPipeline returned no outcome');
  if (outcome.status !== 'active') fail(`expected status=active, got ${outcome.status}`);
  if (!outcome.eventHash) fail('eventHash missing');
  ok(`signed: factId=${outcome.factId}`);
  ok(`        eventHash=${outcome.eventHash.slice(0, 16)}…`);
  ok(`        chained onto parent=${outcome.parentHashForNext.slice(0, 16)}…`);

  // --- Stage 4: canon_cite-equivalent read-back ---
  console.log(SEP);
  const cited = await prisma.factEvent.findFirst({
    where: { userId: user.id, id: outcome.factId },
  });
  if (!cited) fail('written fact not found by id');
  if (cited.eventHash !== outcome.eventHash) fail('eventHash mismatch on read-back');
  if (!cited.coseSign1Hex || cited.coseSign1Hex.length < 50) fail('COSE_Sign1 envelope missing or too short');
  ok(`canon_cite read-back: factId matches`);
  ok(`                      eventHash matches`);
  ok(`                      COSE_Sign1 envelope: ${cited.coseSign1Hex.length} hex chars`);
  ok(`                      signerPubkey: ${cited.signerPubkey.slice(0, 30)}…`);

  // --- Stage 5: resolve.ts type-check (no DB mutation) ---
  console.log(SEP);
  const ghostResult = await resolveCanonical({
    userId: user.id,
    entity: '_does_not_exist',
    metricKey: '_does_not_exist',
    winnerFactId: 'f_definitely_does_not_exist',
  });
  if (ghostResult.ok) fail('resolveCanonical should fail on non-existent factId');
  if (ghostResult.reason !== 'winner-fact-not-found') fail(`unexpected reason: ${ghostResult.reason}`);
  ok(`resolveCanonical handles missing winner: reason=${ghostResult.reason}`);

  const ghostDistinct = await resolveDistinct({
    userId: user.id,
    entity: '_does_not_exist',
    metricKey: '_does_not_exist',
    candidateFactIds: ['f_x'],
  });
  if (ghostDistinct.ok) fail('resolveDistinct should fail on <2 candidates');
  if (ghostDistinct.reason !== 'need-at-least-2-candidates') fail(`unexpected reason: ${ghostDistinct.reason}`);
  ok(`resolveDistinct enforces ≥2 candidates: reason=${ghostDistinct.reason}`);

  // --- Done ---
  console.log(SEP);
  console.log('All stages passed.');
  console.log(`Test fact left in chain: ${outcome.factId} (entity ${testEntity})`);
  console.log(`Cleanup: prisma.factEvent.update({where:{id:'${outcome.factId}'}, data:{status:'superseded', notes:'smoke-test-cleanup'}})`);
  console.log(SEP);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(`\n✗ FATAL: ${(e as Error).stack ?? String(e)}`);
  await prisma.$disconnect();
  process.exit(1);
});
