/**
 * /decide demo seed.
 *
 * Inserts two pre-staged conflict scenarios into the inazuma workspace,
 * each consisting of two competing FactEvents with author-suffixed
 * sourceRefs so the /decide page can surface them as decision-cards.
 *
 *   Card 1 — bright_plc.q1_revenue:
 *     €127,000 from slack (alice@inazuma.example)  vs
 *     €150,000 from gmail (bob@inazuma.example)
 *
 *   Card 2 — miller_group.per_seat_price:
 *     €2,400/year from slack (lina@inazuma.example) vs
 *     €2,200/year from gmail (greg@inazuma.example)
 *
 * Both pairs are signed through CanonSigner against the live tail hash
 * so they participate in the same hash-chain as everything else.
 *
 * Idempotency: looks up existing facts with matching sourceRef-prefix; if
 * any exist for a scenario, the seed re-uses them (does not duplicate).
 *
 * Usage:
 *   npx tsx scripts/seed-decide.ts                 # default user nelson@ultranova.io
 *   npx tsx scripts/seed-decide.ts --owner=<email> # use a different workspace owner
 *   npx tsx scripts/seed-decide.ts --dry-run       # print, don't write
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma';
import { CanonSigner } from '../src/lib/canon/sign';

const prisma = new PrismaClient();

interface SeedFact {
  entity: string;
  metricKey: string;
  metricValue: string;
  metricUnit: string | null;
  claim: string;
  sourceRef: string;
  sourceExcerpt: string;
}

const SCENARIOS: { label: string; facts: SeedFact[] }[] = [
  {
    label: 'Card 1 · bright_plc Q1 revenue (consensus path)',
    facts: [
      {
        entity: 'bright_plc',
        metricKey: 'q1_revenue',
        metricValue: '€127,000',
        metricUnit: 'EUR',
        claim:
          'Bright Plc Q1 2026 revenue came in at €127,000 — board-deck number, signed off Friday.',
        sourceRef: 'slack:C0B058UN0PK:1745580120.000100#u=alice@inazuma.example',
        sourceExcerpt:
          'Just locked Q1 numbers — Bright Plc revenue is €127k, board-approved.',
      },
      {
        entity: 'bright_plc',
        metricKey: 'q1_revenue',
        metricValue: '€150,000',
        metricUnit: 'EUR',
        claim:
          'Bright Plc Q1 revenue ~€150,000 per the latest customer-success summary.',
        sourceRef:
          'gmail:demo-decide-c1-msg-bob#p0#from=bob@inazuma.example',
        sourceExcerpt:
          'CS summary thread says Bright Plc Q1 revenue ~€150k — keeping you in the loop.',
      },
    ],
  },
  {
    label: 'Card 2 · miller_group per-seat price (escalation path)',
    facts: [
      {
        entity: 'miller_group',
        metricKey: 'per_seat_price',
        metricValue: '€2,400/year',
        metricUnit: 'EUR/seat/year',
        claim:
          'Miller Group per-seat price quoted at €2,400/year in the new SOW.',
        sourceRef: 'slack:C0B058UN0PK:1745601420.000100#u=lina@inazuma.example',
        sourceExcerpt:
          'Heads up — Miller Group per-seat price is €2,400/yr in the new SOW we sent.',
      },
      {
        entity: 'miller_group',
        metricKey: 'per_seat_price',
        metricValue: '€2,200/year',
        metricUnit: 'EUR/seat/year',
        claim:
          'Miller Group per-seat price quoted at €2,200/year in the contract draft.',
        sourceRef:
          'gmail:demo-decide-c2-msg-greg#p0#from=greg@inazuma.example',
        sourceExcerpt:
          'Greg (account lead) sent the contract draft with €2,200/yr per-seat pricing for Miller.',
      },
    ],
  },
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const ownerArg = args.find((a) => a.startsWith('--owner='))?.split('=')[1];
  const ownerEmail = ownerArg ?? 'nelson@ultranova.io';
  const workspace = 'inazuma';

  const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    console.error(
      `[seed-decide] no User row for ${ownerEmail}. ` +
        `Sign in once on canon.ultranova.io to provision, then re-run.`,
    );
    process.exit(1);
  }
  console.log(`[seed-decide] owner=${owner.email} userId=${owner.id} workspace=${workspace}`);

  for (const scenario of SCENARIOS) {
    console.log(`\n--- ${scenario.label} ---`);

    // Idempotency: skip facts that already exist (same sourceRef + entity).
    const existing = await prisma.factEvent.findMany({
      where: {
        userId: owner.id,
        workspace,
        sourceRef: { in: scenario.facts.map((f) => f.sourceRef) },
      },
      select: { sourceRef: true, id: true, metricValue: true },
    });
    if (existing.length === scenario.facts.length) {
      console.log('  ✓ already seeded; skipping');
      for (const e of existing) console.log(`    fact=${e.id} value=${e.metricValue}`);
      continue;
    }

    for (const f of scenario.facts) {
      const dup = existing.find((e) => e.sourceRef === f.sourceRef);
      if (dup) {
        console.log(`  ↺ exists  ${dup.id}  ${f.metricValue}`);
        continue;
      }
      if (dryRun) {
        console.log(`  ✎ would seed  ${f.entity}.${f.metricKey} = ${f.metricValue} (${f.sourceRef})`);
        continue;
      }

      const tail = await prisma.factEvent.findFirst({
        where: { userId: owner.id, workspace },
        orderBy: { signedAt: 'desc' },
        select: { eventHash: true },
      });
      const parentHash = tail?.eventHash ?? '';
      const factId = `f_seed_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

      const signer = new CanonSigner();
      signer.start();
      let sig;
      try {
        sig = await signer.sign({
          factId,
          entity: f.entity,
          claim: f.claim,
          sourceRef: f.sourceRef,
          sourceExcerpt: f.sourceExcerpt,
          parentHash,
          createdAtMs: Date.now(),
        });
      } finally {
        await signer.close();
      }

      await prisma.factEvent.create({
        data: {
          id: factId,
          userId: owner.id,
          workspace,
          entity: f.entity,
          claim: f.claim,
          metricKey: f.metricKey,
          metricValue: f.metricValue,
          metricUnit: f.metricUnit,
          sourceRef: f.sourceRef,
          sourceExcerpt: f.sourceExcerpt,
          parentHash: parentHash || null,
          eventHash: sig.eventHash,
          coseSign1Hex: sig.coseSign1Hex,
          signerPubkey: sig.signerPubkey,
          signedAt: new Date(sig.signedAtMs),
          observedAt: new Date(),
          status: 'active',
          notes: 'seed:decide-demo',
        },
      });
      console.log(`  + ${factId}  ${f.entity}.${f.metricKey} = ${f.metricValue}`);
    }
  }

  console.log(`\n[seed-decide] done. Open ${process.env.AUTH_URL ?? 'http://localhost:3000'}/decide`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
