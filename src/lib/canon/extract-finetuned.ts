/**
 * Fine-tuned GLiNER-2 extractor — Inazuma-domain-tuned variant.
 *
 * Primary backend: Pioneer's `/inference` endpoint with the training-job UUID
 * of our Pioneer-deployed fine-tune (`PIONEER_FT_MODEL_ID`).
 * Fallback backend: Modal-hosted endpoint serving the same architecture
 * trained with proper LR (`GLINER_FT_ENDPOINT`).
 *
 * Activated by `USE_FT_MODEL=true`. The default extractor (pioneer.ts) remains
 * untouched for the live ingest loop.
 *
 * Trained on the Qontext/Inazuma corpus (Big Berlin Hack 2026) via Pioneer's
 * `/felix/training-jobs` API (Agent-driven path; see bug report in
 * `bigHack/pioneer-gliner-finetune/`).
 */

const DEFAULT_THRESHOLD = 0.4;
const FT_TIMEOUT_MS = 30_000;

const env = {
  base: () => process.env.PIONEER_BASE_URL ?? 'https://api.pioneer.ai',
  pioneerKey: () => process.env.PIONEER_API_KEY ?? '',
  pioneerModelId: () => process.env.PIONEER_FT_MODEL_ID ?? '',
  modalEndpoint: () => process.env.GLINER_FT_ENDPOINT ?? '',
};

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

export type FtBackend = 'pioneer' | 'modal';

export interface FtExtractResponse {
  spans: FtSpan[];
  /** Stamped on every result so downstream auditors know which model produced it. */
  extractorModel: 'pioneer-fastino-gliner2-ft' | 'modal-gliner-large-v2.1-ft';
  backend: FtBackend;
  latencyMs: number;
}

export class FtExtractorNotConfigured extends Error {
  constructor() {
    super('Neither PIONEER_FT_MODEL_ID+PIONEER_API_KEY nor GLINER_FT_ENDPOINT is set');
  }
}

interface PioneerEntityHit {
  text: string;
  start?: number;
  end?: number;
  score?: number;
}

interface PioneerInferenceResponse {
  type: 'encoder';
  inference_id: string;
  result: {
    entities?: Record<string, PioneerEntityHit[]>;
  };
  model_id: string;
  latency_ms: number;
  model_used: string;
}

async function ftExtractPioneer(req: FtExtractRequest): Promise<FtExtractResponse> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FT_TIMEOUT_MS);
  try {
    const r = await fetch(`${env.base()}/inference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': env.pioneerKey() },
      body: JSON.stringify({
        model_id: env.pioneerModelId(),
        task: 'extract_entities',
        text: req.text,
        schema: req.labels ?? FT_LABELS,
        threshold: req.threshold ?? DEFAULT_THRESHOLD,
        include_spans: true,
      }),
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`Pioneer /inference ${r.status}: ${await r.text()}`);
    const data = (await r.json()) as PioneerInferenceResponse;
    const byLabel = data.result?.entities ?? {};
    const spans: FtSpan[] = [];
    for (const lbl of FT_LABELS) {
      for (const hit of byLabel[lbl] ?? []) {
        if (!hit?.text) continue;
        spans.push({
          text: hit.text,
          label: lbl,
          start: hit.start ?? req.text.indexOf(hit.text),
          end: hit.end ?? req.text.indexOf(hit.text) + hit.text.length,
          score: hit.score,
        });
      }
    }
    return {
      spans,
      extractorModel: 'pioneer-fastino-gliner2-ft',
      backend: 'pioneer',
      latencyMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function ftExtractModal(req: FtExtractRequest): Promise<FtExtractResponse> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FT_TIMEOUT_MS);
  try {
    const r = await fetch(env.modalEndpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: req.text,
        labels: req.labels ?? FT_LABELS,
        threshold: req.threshold ?? DEFAULT_THRESHOLD,
      }),
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`Modal FT ${r.status}: ${await r.text()}`);
    const data = (await r.json()) as { spans?: FtSpan[] };
    return {
      spans: (data.spans ?? []).filter((s): s is FtSpan =>
        FT_LABELS.includes(s.label as FtLabel),
      ),
      extractorModel: 'modal-gliner-large-v2.1-ft',
      backend: 'modal',
      latencyMs: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the fine-tuned extractor. Backend is chosen by:
 *   1. `FT_BACKEND=pioneer|modal` env var if set
 *   2. Pioneer if `PIONEER_FT_MODEL_ID` + `PIONEER_API_KEY` are set
 *   3. Modal if `GLINER_FT_ENDPOINT` is set
 *   4. Throws otherwise
 */
export async function ftExtract(req: FtExtractRequest): Promise<FtExtractResponse> {
  const forced = process.env.FT_BACKEND as FtBackend | undefined;
  if (forced === 'pioneer') return ftExtractPioneer(req);
  if (forced === 'modal') return ftExtractModal(req);
  if (env.pioneerModelId() && env.pioneerKey()) return ftExtractPioneer(req);
  if (env.modalEndpoint()) return ftExtractModal(req);
  throw new FtExtractorNotConfigured();
}

/** True when the FT extractor should be preferred over Pioneer zero-shot. */
export function ftExtractorEnabled(): boolean {
  return (
    process.env.USE_FT_MODEL === 'true' &&
    ((Boolean(env.pioneerModelId()) && Boolean(env.pioneerKey())) || Boolean(env.modalEndpoint()))
  );
}
