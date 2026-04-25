/**
 * Conflict summariser — wraps Gemini 2.5-flash to produce a 1-paragraph
 * explanation of why N competing FactEvents disagree, plus a structured
 * recommendation the resolve modal renders next to the user's two action
 * buttons (canonical vs distinct).
 *
 * Critic role only — never mutates facts, never signs anything. The
 * recommendation is a hint for the human; the human still presses the
 * button and the resulting ResolutionEvent is signed exactly as before.
 */

import { GoogleGenAI, Type } from '@google/genai';
import type { FactRow } from './view';
import { bootstrapVertexAuth } from './vertex-bootstrap';

const MODEL = process.env.CANON_AUDIT_MODEL ?? 'gemini-2.5-flash';

let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI {
  if (aiClient) return aiClient;
  bootstrapVertexAuth();
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION;
  if (!project || !location) {
    throw new Error('GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION not set');
  }
  aiClient = new GoogleGenAI({ vertexai: true, project, location });
  return aiClient;
}

export type ConflictRecommendation = 'canonical' | 'distinct' | 'unclear';

export interface ConflictSummary {
  /** 2-4 sentence plain-language explanation of WHY the candidates differ. */
  summary: string;
  /** Hint for the human pressing the button. */
  recommendation: ConflictRecommendation;
  /** When recommendation='canonical': the factId the model would pick. */
  winnerFactId?: string;
  /** ≤300 chars: justification the model gives for the recommendation. */
  reasoning: string;
  /** Round-trip latency for the badge. */
  latencyMs: number;
  /** Model id actually used (for debug + future audit). */
  model: string;
}

const SYSTEM_PROMPT = `You are a business-data analyst reviewing competing FactEvent records for the same entity + metric in a signed knowledge ledger.

Your job: explain in 2-4 sentences WHY the candidates disagree, and recommend ONE of three resolutions:

- "canonical"  — one candidate is clearly more authoritative (newer, richer source, agrees with majority). Pick its factId.
- "distinct"   — the candidates describe INDEPENDENT real-world records that happen to share an entity slug (different client_ids, different time-windows, dual-role customer/vendor). DO NOT pick a winner.
- "unclear"    — not enough signal to recommend either. Explain what extra info would help.

Rules:
- Be terse. Plain language. No emojis.
- "summary" focuses on the WHY (what's different across the records), not the recommendation.
- "reasoning" justifies the recommendation in ≤300 chars.
- "winnerFactId" is REQUIRED when recommendation="canonical" and MUST equal one of the candidate factIds verbatim. Omit otherwise.
- Treat differences in client_id / record-id (visible in the source ref) as a strong "distinct" signal.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    recommendation: {
      type: Type.STRING,
      enum: ['canonical', 'distinct', 'unclear'],
    },
    winnerFactId: { type: Type.STRING },
    reasoning: { type: Type.STRING },
  },
  required: ['summary', 'recommendation', 'reasoning'],
} as const;

export async function summarizeConflict(args: {
  entity: string;
  metricKey: string;
  facts: FactRow[];
}): Promise<ConflictSummary> {
  const t0 = Date.now();
  const ai = getAi();

  const userBlocks = args.facts.map((f, i) => {
    const ref = f.sourceRef;
    const obs = f.observedAt?.toISOString().slice(0, 10) ?? '(no date)';
    const excerpt = (f.sourceExcerpt ?? f.claim).replace(/\s+/g, ' ').trim().slice(0, 220);
    return [
      `Candidate #${i + 1}`,
      `  factId:        ${f.id}`,
      `  metricValue:   ${f.metricValue ?? '(none)'}${f.metricUnit ? ' ' + f.metricUnit : ''}`,
      `  sourceRef:     ${ref}`,
      `  observed:      ${obs}`,
      `  signedAt:      ${f.signedAt.toISOString()}`,
      `  excerpt:       "${excerpt}"`,
    ].join('\n');
  });

  const userPrompt = [
    `Entity:    ${args.entity}`,
    `Metric:    ${args.metricKey}`,
    `Candidates: ${args.facts.length}`,
    '',
    ...userBlocks,
  ].join('\n');

  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  });

  const text = res.text ?? '';
  let parsed: {
    summary: string;
    recommendation: ConflictRecommendation;
    winnerFactId?: string;
    reasoning: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      summary: 'Gemini returned a non-JSON response — see server logs.',
      recommendation: 'unclear',
      reasoning: text.slice(0, 300),
      latencyMs: Date.now() - t0,
      model: MODEL,
    };
  }

  // Validate winnerFactId actually matches a candidate when recommendation=canonical.
  if (parsed.recommendation === 'canonical') {
    const ids = new Set(args.facts.map((f) => f.id));
    if (!parsed.winnerFactId || !ids.has(parsed.winnerFactId)) {
      // Soften to 'unclear' rather than let the UI render a bogus winnerFactId.
      parsed.recommendation = 'unclear';
      parsed.winnerFactId = undefined;
    }
  }

  return {
    summary: parsed.summary,
    recommendation: parsed.recommendation,
    winnerFactId: parsed.winnerFactId,
    reasoning: parsed.reasoning,
    latencyMs: Date.now() - t0,
    model: MODEL,
  };
}
