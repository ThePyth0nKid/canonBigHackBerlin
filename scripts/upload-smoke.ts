/**
 * Local smoke test for src/lib/ingest/upload.ts. Constructs a few
 * representative File-shaped inputs and prints what the router decided.
 * Catches obvious parse / shape-detection regressions before deploying.
 *
 *   npx tsx scripts/upload-smoke.ts
 */

import { parseUploadedFile } from '../src/lib/ingest/upload';

function fakeFile(name: string, body: string): File {
  return new File([new TextEncoder().encode(body)], name, {
    type: 'application/octet-stream',
  });
}

async function run() {
  const cases: { name: string; file: File }[] = [
    {
      name: 'qontext-clients (typed mapper)',
      file: fakeFile(
        'clients.json',
        JSON.stringify([
          {
            client_id: 'C1',
            business_name: 'Miller Group',
            industry: 'Manufacturing',
            monthly_revenue: '3990000',
            contact_person_name: 'Jane Doe',
            onboarding_date: '2025-09-01',
          },
          {
            client_id: 'C2',
            business_name: 'Gonzalez Inc',
            industry: 'Entertainment',
            monthly_revenue: '4200000',
            contact_person_name: 'John Roe',
            onboarding_date: '2025-08-15',
          },
        ]),
      ),
    },
    {
      name: 'qontext-emails (chunks → Pioneer)',
      file: fakeFile(
        'emails.json',
        JSON.stringify([
          {
            email_id: 'E1',
            date: '2025-10-01',
            subject: 'Q3 ARR check',
            body: 'Hi team — ARR is currently at €3.4M which is up 18% YoY.',
          },
        ]),
      ),
    },
    {
      name: 'generic-json (unknown shape → fallback)',
      file: fakeFile(
        'crm.json',
        JSON.stringify([
          {
            id: 'a1',
            company_name: 'ACME GmbH',
            mrr: '€127,000',
            renewal_date: '2026-05-15',
          },
          {
            id: 'a2',
            company_name: 'TechCo',
            mrr: '€98,000',
            renewal_date: '2026-07-20',
          },
        ]),
      ),
    },
    {
      name: 'csv (header → routed)',
      file: fakeFile(
        'export.csv',
        'company_name,mrr,renewal_date\nACME GmbH,€127000,2026-05-15\nTechCo,€98000,2026-07-20\n',
      ),
    },
    {
      name: 'ndjson',
      file: fakeFile(
        'stream.ndjson',
        '{"company_name":"ACME","mrr":"127k"}\n{"company_name":"TechCo","mrr":"98k"}\n',
      ),
    },
    {
      name: 'plain text (paragraphs)',
      file: fakeFile(
        'notes.txt',
        'ACME GmbH renewed at €127,000 MRR effective May 15.\n\nTechCo expanded to 50 seats this quarter.\n\nGlobex churn is currently 2.3%.',
      ),
    },
  ];

  for (const c of cases) {
    try {
      const r = await parseUploadedFile(c.file);
      console.log(
        `✓ ${c.name} — shape=${r.shape} records=${r.recordCount} drafts=${r.directDrafts.length} chunks=${r.pipelineChunks.length}`,
      );
      const sample = r.directDrafts[0] ?? null;
      if (sample) console.log(`  → ${sample.entity}: ${sample.claim}`);
      const chunkSample = r.pipelineChunks[0] ?? null;
      if (chunkSample) console.log(`  → chunk: ${chunkSample.text.slice(0, 80)}`);
    } catch (e) {
      console.log(`✗ ${c.name} — ${(e as Error).message}`);
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
