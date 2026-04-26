/**
 * Fine-tuned GLiNER-2 extractor — Inazuma-domain-tuned variant.
 *
 * Calls a Modal-hosted inference endpoint serving our fine-tuned model.
 * Activated by setting USE_FT_MODEL=true. The default extractor (pioneer.ts)
 * remains untouched for the live ingest loop.
 *
 * Trained on the Qontext/Inazuma corpus (Big Berlin Hack 2026) with
 * tri-model-consensus gold + Gemini-synthesised + templated training data.
 * See bigHack/pioneer-gliner-finetune/ for the full sprint plan.
 */

const FT_ENDPOINT = process.env.GLINER_FT_ENDPOINT ?? '';
const DEFAULT_THRESHOLD = 0.4;
const FT_TIMEOUT_MS = 30_000;

export const FT_LABELS = [
  'EMPLOYEE',
  'EMPLOYEE_ID',
  'CUSTOMER_ID',
  'PRODUCT_ID',
  'TICKET_ID',
  'THREAD_ID',
  'AMOUNT',
  'DEPARTMENT',
  'POLICY_NAME',
  'DATE',
] as const;

export type FtLabel = (typeof FT_LABELS)[number];

export interface FtSpan {
  text: string;
  label: FtLabel;
  start: number;
  end: number;
  score?: number;
}

export interface FtExtractRequest {
  text: string;
  labels?: readonly string[];
  threshold?: number;
}

export interface FtExtractResponse {
  spans: FtSpan[];
  /** Stamped on every result so downstream auditors know which model produced it. */
  extractorModel: 'gliner-ft-canon-inazuma-v1';
}

export class FtExtractorNotConfigured extends Error {
  constructor() {
    super('GLINER_FT_ENDPOINT not set; cannot call fine-tuned extractor');
  }
}

/**
 * Call the Modal-hosted fine-tuned model on a single text snippet.
 * Returns labelled spans with verbatim surface forms + char offsets.
 *
 * Throws if the endpoint is unset or the call fails. Callers must decide
 * whether to fall back to the zero-shot Pioneer path.
 */
export async function ftExtract(req: FtExtractRequest): Promise<FtExtractResponse> {
  if (!FT_ENDPOINT) throw new FtExtractorNotConfigured();

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FT_TIMEOUT_MS);

  try {
    const r = await fetch(FT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: req.text,
        labels: req.labels ?? FT_LABELS,
        threshold: req.threshold ?? DEFAULT_THRESHOLD,
      }),
      signal: ac.signal,
    });
    if (!r.ok) {
      throw new Error(`FT endpoint ${r.status}: ${await r.text()}`);
    }
    const data = (await r.json()) as { spans?: FtSpan[] };
    return {
      spans: (data.spans ?? []).filter((s): s is FtSpan =>
        FT_LABELS.includes(s.label as FtLabel),
      ),
      extractorModel: 'gliner-ft-canon-inazuma-v1',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** True when the FT extractor should be preferred over Pioneer zero-shot. */
export function ftExtractorEnabled(): boolean {
  return process.env.USE_FT_MODEL === 'true' && Boolean(FT_ENDPOINT);
}
