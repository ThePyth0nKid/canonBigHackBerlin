#!/usr/bin/env -S npx tsx
/**
 * Verifies the canon-mcp resolveDemoUserId() fix routes to the user with
 * the most facts, not the most-recent createdAt.
 *
 * Mirrors the exact logic in mcp/canon-mcp.ts so we can confirm in
 * isolation without spawning the MCP server.
 */
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '..', '.env'), quiet: true });
loadDotenv({ path: resolve(__dirname, '..', '.env.local'), override: true, quiet: true });

import { prisma } from '../src/lib/prisma';

async function main() {
  // OLD logic (broken):
  const oldPick = await prisma.user.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, createdAt: true },
  });
  const oldFacts = await prisma.factEvent.count({
    where: { userId: oldPick!.id, workspace: 'inazuma', status: 'active' },
  });
  console.log('OLD heuristic (findFirst orderBy createdAt desc):');
  console.log(`  → ${oldPick?.email}  (${oldFacts} active inazuma facts)`);

  // NEW logic (the canon-mcp fix):
  const owners = await prisma.factEvent.groupBy({
    by: ['userId'],
    where: { status: 'active', workspace: 'inazuma' },
    _count: { _all: true },
    orderBy: { _count: { userId: 'desc' } },
    take: 1,
  });
  if (owners.length === 0) {
    console.log('NEW heuristic: no users have inazuma facts → would fall back to most-recent');
    return;
  }
  const newUser = await prisma.user.findFirst({
    where: { id: owners[0].userId },
    select: { id: true, email: true, createdAt: true },
  });
  console.log('\nNEW heuristic (groupBy userId, most facts wins):');
  console.log(`  → ${newUser?.email}  (${owners[0]._count._all} active inazuma facts)`);

  console.log('\n— diff —');
  if (oldPick?.id === newUser?.id) {
    console.log('  same user — no change in this DB state');
  } else {
    console.log(`  routing FIXED: ${oldPick?.email} → ${newUser?.email}`);
    console.log(`  fact-count delta: ${oldFacts} → ${owners[0]._count._all}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
