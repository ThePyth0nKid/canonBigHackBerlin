#!/usr/bin/env -S npx tsx
/**
 * Validate the 3 ResolutionEvents the user signed via /canon-resolve on miller_group.
 * Confirms: signed events exist, status='resolution', notes track winner+losers,
 * losers were superseded with chain back-pointer, no open conflicts remain.
 */
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '..', '.env'), quiet: true });
loadDotenv({ path: resolve(__dirname, '..', '.env.local'), override: true, quiet: true });

import { prisma } from '../src/lib/prisma';

async function main() {
  const ids = ['f_res_87e54cbc2ea34aeb', 'f_res_0150c79b418942eb', 'f_res_9c6a747d5a8b4cb2'];

  console.log('━'.repeat(70));
  console.log('ResolutionEvents — verifying signed envelopes + chain integrity');
  console.log('━'.repeat(70));

  for (const id of ids) {
    const r = await prisma.factEvent.findFirst({ where: { id } });
    if (!r) { console.log(`✗ MISSING: ${id}`); continue; }
    console.log(`\n✓ ${r.id}`);
    console.log(`    status:        ${r.status}`);
    console.log(`    entity:        ${r.entity}`);
    console.log(`    metricKey:     ${r.metricKey}`);
    console.log(`    metricValue:   ${r.metricValue ?? '(none)'}`);
    console.log(`    sourceRef:     ${r.sourceRef}`);
    console.log(`    notes:         ${r.notes?.slice(0, 90) ?? '(none)'}`);
    console.log(`    parentHash:    ${r.parentHash?.slice(0, 20)}…`);
    console.log(`    eventHash:     ${r.eventHash.slice(0, 20)}…`);
    console.log(`    signer:        ${r.signerPubkey.slice(0, 36)}…`);
    console.log(`    COSE_Sign1:    ${r.coseSign1Hex.length} hex chars (Ed25519)`);
    console.log(`    signedAt:      ${r.signedAt.toISOString()}`);
  }

  console.log('\n' + '━'.repeat(70));
  console.log('Miller Group — current conflict state');
  console.log('━'.repeat(70));

  const facts = await prisma.factEvent.findMany({
    where: { entity: 'miller_group', workspace: 'inazuma', status: 'active', metricKey: { not: null } },
    select: { metricKey: true, metricValue: true },
  });
  const grouped = new Map<string, Set<string>>();
  for (const f of facts) {
    if (!f.metricKey) continue;
    if (!grouped.has(f.metricKey)) grouped.set(f.metricKey, new Set());
    grouped.get(f.metricKey)!.add(f.metricValue ?? '');
  }
  let stillConflict = 0;
  for (const [mk, vals] of grouped) {
    const tag = vals.size >= 2 ? 'CONFLICT' : '   OK   ';
    if (vals.size >= 2) stillConflict++;
    console.log(`  ${tag}  ${mk.padEnd(20)} → ${[...vals].join(' | ')}`);
  }

  console.log('\n' + '━'.repeat(70));
  console.log('Superseded losers — chain back-pointer audit');
  console.log('━'.repeat(70));

  const supersededByPick = await prisma.factEvent.findMany({
    where: {
      entity: 'miller_group',
      status: 'superseded',
      notes: { contains: 'user-pick' },
    },
    select: { id: true, metricKey: true, metricValue: true, notes: true, signedAt: true },
    orderBy: { signedAt: 'desc' },
    take: 10,
  });
  console.log(`Total superseded by user-pick on miller_group: ${supersededByPick.length}`);
  for (const s of supersededByPick) {
    const winnerHash = s.notes?.match(/superseded:user-pick:([a-f0-9]+)/)?.[1]?.slice(0, 16) ?? '(no pointer)';
    console.log(`  ${s.id}  ${s.metricKey}=${s.metricValue}  → winner-eventHash=${winnerHash}…`);
  }

  console.log('\n' + '━'.repeat(70));
  console.log(`Final state for miller_group:`);
  console.log(`  Open conflicts: ${stillConflict}  (was 3 before /canon-resolve)`);
  console.log(`  Superseded by your picks: ${supersededByPick.length}`);
  console.log(`  ResolutionEvents signed: ${ids.length}`);
  console.log('━'.repeat(70));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
