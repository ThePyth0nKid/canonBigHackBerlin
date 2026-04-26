/**
 * E2E smoke test for src/lib/canon/extract-finetuned.ts.
 * Runs both backends (Pioneer + Modal) on a representative Inazuma sentence
 * and prints side-by-side spans, latency, and extractor-model stamp.
 *
 * Run:
 *   PIONEER_API_KEY=... PIONEER_FT_MODEL_ID=29473289-... \
 *   GLINER_FT_ENDPOINT=https://thepyth0nkid--canon-gliner-ft-predict.modal.run \
 *   USE_FT_MODEL=true \
 *   pnpm tsx scripts/smoke-ft-extractor.ts
 */

import { config } from 'dotenv';
import { ftExtract, ftExtractorEnabled, FT_LABELS } from '../src/lib/canon/extract-finetuned';

config({ path: '.env.local' });
config({ path: '.env' });

const SAMPLE = `Hi Ravi Kumar (emp_1002), the customer arout placed an order for B07JW9H4J1 worth ₹399 on 2024-12-15. Per the Data Protection Policy, ticket 717 from HR is now resolved. Thread THR_20241104_d2b538 contains the full discussion.`;

async function run(backend: 'pioneer' | 'modal') {
  process.env.FT_BACKEND = backend;
  console.log(`\n=== ${backend.toUpperCase()} ===`);
  try {
    const r = await ftExtract({ text: SAMPLE });
    console.log(`extractorModel: ${r.extractorModel}`);
    console.log(`latency: ${r.latencyMs}ms`);
    console.log(`spans (${r.spans.length}):`);
    for (const s of r.spans) {
      const score = s.score != null ? ` [${s.score.toFixed(3)}]` : '';
      console.log(`  [${s.label.padEnd(13)}] ${s.text}${score}`);
    }
  } catch (err) {
    console.error(`  FAILED: ${(err as Error).message}`);
  }
}

async function main() {
  console.log('FT extractor enabled:', ftExtractorEnabled());
  console.log('Labels:', FT_LABELS.join(', '));
  console.log(`\nINPUT:\n  ${SAMPLE}`);
  await run('pioneer');
  await run('modal');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
