/**
 * Direct unit test of postProcessDraft. Hand-feeds the demo's tricky chunks
 * and prints what comes out — independent of Pioneer.
 */
import 'dotenv/config';
import { extractFactsFromChunks, type Chunk } from '../src/lib/canon/pioneer';

const cases: Chunk[] = [
  {
    text: '[canon-demo] TechCo churn — paperwork. - Seats: 12 - MRR lost: €2,400 (12 × €200/mo) - Effective: end of April 2026 - Primary reason: competitor bundles billing integration natively',
    sourceRef: 'gmail:dbg1#p0',
    observedAt: '2026-04-21T10:00:00Z',
    sourceExcerpt: '...',
    defaultEntity: 'northwind',
  },
  {
    text: '[canon-demo] ACME early-sizing — could be 40 seats. Final seat count TBD after internal review end of Q1 — could come in at 40, could stretch higher depending on RevOps headcount plan.',
    sourceRef: 'gmail:dbg2#p0',
    observedAt: '2026-03-27T10:00:00Z',
    sourceExcerpt: '...',
    defaultEntity: 'northwind',
  },
  {
    text: 'Risks & Mitigations TechCo churn — competitive loss: 12 seats, €2,400 MRR, reason: "using competitor for billing integration" → Mitigation: prioritize billing-integration roadmap',
    sourceRef: 'pdf:dbg3#p9',
    observedAt: '2026-04-25T00:00:00Z',
    sourceExcerpt: '...',
    defaultEntity: 'northwind',
  },
];

async function main() {
  const drafts = await extractFactsFromChunks(cases);
  for (const d of drafts) {
    console.log(JSON.stringify({ entity: d.entity, metric: d.metric, ref: d.sourceRef }));
  }

  // Assertions — what the demo expects for each tricky chunk.
  const has = (entity: string, key: string, valueRe: RegExp) =>
    drafts.some(
      (d) =>
        d.entity === entity &&
        d.metric?.key === key &&
        valueRe.test(d.metric.value),
    );

  console.assert(has('techco', 'churn', /2,?400/), 'expected techco.churn=€2,400 (gmail/pdf chunks)');
  console.assert(has('techco', 'seats', /^12$/), 'expected techco.seats=12 (PDF Risks slide)');
  console.assert(has('acme', 'seats', /^40$/), 'expected acme.seats=40 (Greg early-sizing email)');
  console.assert(
    !drafts.some((d) => d.entity === 'northwind' && d.metric?.key === 'mrr' && /2,?400/.test(d.metric.value)),
    'must not emit northwind.mrr=€2,400 (that is TechCo churn)',
  );
  console.assert(
    !drafts.some((d) => d.entity === 'acme' && d.metric?.key === 'forecast'),
    'must not emit acme.forecast (forecast is a house metric)',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
