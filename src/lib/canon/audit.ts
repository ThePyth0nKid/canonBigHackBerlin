/**
 * Gemini 2.5-flash long-context auditor — Layer 2 of the Trust Pipeline.
 *
 * Reads the *whole* source body (full Slack channel, full inbox thread,
 * the entire PDF) and judges whether each Pioneer-extracted FactDraft is
 * confirmed by the surrounding context or contradicted/superseded by a
 * later or more authoritative statement.
 *
 * Critic role only — never edits the claim. Drafts are still signed in
 * either case; auditor output flips `status` to `superseded` for the
 * pipeline downstream when contradicted.
 */

import { GoogleGenAI } from '@google/genai';
import type { FactDraft } from './types';

const MODEL = process.env.CANON_AUDIT_MODEL ?? 'gemini-2.5-flash';
const MAX_CONTEXT_CHARS = 120_000;

let aiClient: GoogleGenAI | null = null;

function getAi(): GoogleGenAI {
  if (aiClient) return aiClient;
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION;
  if (!project || !location) {
    throw new Error('GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION not set');
  }
  aiClient = new GoogleGenAI({ vertexai: true, project, location });
  return aiClient;
}

export interface AuditVerdict {
  confirmed: boolean;
  /** Non-empty when confirmed=false: short reason (≤200 chars). */
  contradiction?: string;
  /** 0..1 — model's stated certainty. */
  confidence: number;
}

export interface AuditInput {
  draft: FactDraft;
  /** Full source body the draft came from (channel/inbox/PDF). */
  context: string;
  /** Free-form label for the prompt, e.g. "Slack #sales" or "Q1 board deck". */
  contextLabel: string;
}

const SYSTEM_PROMPT = `You audit a single extracted business fact against the FULL source body it came from.
Decide whether the fact is CONFIRMED (consistent with the surrounding context, not later overridden)
or CONTRADICTED (a later or more authoritative statement supersedes it).
Be terse. Reply with JSON only.

Output schema:
{"confirmed": boolean, "contradiction": string|null, "confidence": number}

Rules:
- "contradiction" is ≤200 chars, explains *what* in the context overrides the fact, or null if confirmed.
- "confidence" is 0..1, reflecting how clearly the context supports the verdict.
- Pure restatements / different wordings of the same claim => confirmed=true.
- Forecasts that were superseded by actuals => contradicted (forecast is stale).
- Recency wins: April > March (e.g. ACME 50 seats April supersedes ACME 40 seats March).
- Cross-source corroboration is OUTSIDE your job here — judge only against this one source body.`;

function buildUserPrompt(input: AuditInput): string {
  const { draft, context, contextLabel } = input;
  const ctx = context.length > MAX_CONTEXT_CHARS
    ? context.slice(0, MAX_CONTEXT_CHARS) + '\n[…truncated…]'
    : context;
  const metric = draft.metric
    ? ` metric=${draft.metric.key}=${draft.metric.value}${draft.metric.unit ?? ''}`
    : '';
  return `Source: ${contextLabel}
=== BEGIN SOURCE BODY ===
${ctx}
=== END SOURCE BODY ===

Fact under review:
- entity: ${draft.entity}
- claim: ${draft.claim}${metric}
- sourceRef: ${draft.sourceRef}
- observed: ${draft.observedAt}

Return only the JSON object.`;
}

export async function auditFact(input: AuditInput): Promise<AuditVerdict> {
  const ai = getAi();
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + buildUserPrompt(input) }] },
    ],
    config: {
      responseMimeType: 'application/json',
      temperature: 0,
    },
  });

  const text = res.text ?? '';
  return parseVerdict(text);
}

/**
 * Audit a batch of drafts that all share the same source context.
 * Runs with bounded concurrency; failures degrade to a confidence-0 verdict
 * marked confirmed=true (i.e. don't fail the pipeline if Gemini blips).
 */
export async function auditBatch(
  drafts: FactDraft[],
  context: string,
  contextLabel: string,
  opts?: { concurrency?: number },
): Promise<AuditVerdict[]> {
  const concurrency = opts?.concurrency ?? 4;
  const verdicts: AuditVerdict[] = new Array(drafts.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= drafts.length) return;
      try {
        verdicts[idx] = await auditFact({ draft: drafts[idx], context, contextLabel });
      } catch (e) {
        verdicts[idx] = {
          confirmed: true,
          contradiction: undefined,
          confidence: 0,
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, drafts.length) }, worker),
  );
  return verdicts;
}

function parseVerdict(raw: string): AuditVerdict {
  const text = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(text) as {
      confirmed?: boolean;
      contradiction?: string | null;
      confidence?: number;
    };
    return {
      confirmed: obj.confirmed === true,
      contradiction:
        obj.contradiction && obj.contradiction.length > 0 ? obj.contradiction : undefined,
      confidence:
        typeof obj.confidence === 'number'
          ? Math.max(0, Math.min(1, obj.confidence))
          : 0.5,
    };
  } catch {
    // If Gemini returned malformed JSON, default to confirmed/low-confidence
    // so a flaky audit can't accidentally redact good facts.
    return { confirmed: true, confidence: 0 };
  }
}
