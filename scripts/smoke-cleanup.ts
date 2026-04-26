#!/usr/bin/env -S npx tsx
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '..', '.env'), quiet: true });
loadDotenv({ path: resolve(__dirname, '..', '.env.local'), override: true, quiet: true });

import { prisma } from '../src/lib/prisma';

async function main() {
  // Mark every smoke-test entity as superseded so they don't pollute future demos.
  const smokeFacts = await prisma.factEvent.findMany({
    where: { entity: { startsWith: '_smoke_e2e_' } },
    select: { id: true, entity: true, status: true, userId: true },
  });
  console.log(`smoke facts found: ${smokeFacts.length}`);
  for (const f of smokeFacts) {
    if (f.status === 'superseded') {
      console.log(`  ${f.id} (${f.entity}) already superseded`);
      continue;
    }
    await prisma.factEvent.update({
      where: { id: f.id },
      data: { status: 'superseded', notes: 'smoke-test-cleanup-2026-04-26' },
    });
    console.log(`  ${f.id} (${f.entity}) → superseded`);
  }

  // Diagnostic: which users have facts?
  console.log('\nFact distribution by user:');
  const usersByFacts = await prisma.factEvent.groupBy({ by: ['userId'], _count: true });
  for (const r of usersByFacts.sort((a, b) => b._count - a._count)) {
    const u = await prisma.user.findFirst({
      where: { id: r.userId },
      select: { id: true, email: true, createdAt: true },
    });
    console.log(`  ${r._count.toString().padStart(6)} facts · user ${u?.email ?? '(unknown)'} · created ${u?.createdAt.toISOString() ?? '?'}`);
  }

  console.log('\nresolveDemoUserId() picks (most recent createdAt):');
  const recent = await prisma.user.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, email: true, createdAt: true } });
  console.log(`  ${recent?.email} · ${recent?.createdAt.toISOString()}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
