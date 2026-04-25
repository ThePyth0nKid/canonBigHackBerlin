/**
 * Ask-Canon — free-form Q&A over the signed ledger.
 *
 * Pipeline per question:
 *   1. Retrieval — naive keyword scoring picks top ~30 active facts
 *      whose claim/excerpt/entity match question tokens.
 *   2. Generation — Gemini 2.5-flash gets the question + the candidates
 *      and answers ONLY from them, citing factIds inline as [f_...].
 *   3. Validation — we strip cited factIds out of the model output and
 *      keep only those the retrieval step actually returned, so the UI
 *      can render verifiable links (no citation hallucination).
 *
 * Critic role only — never writes facts. The reply is text + factId
 * pointers; the user clicks through to canon-cite for the proof.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { searchFacts } from './search';

const MODEL = process.env.CANON_AUDIT_MODEL ?? 'gemini-2.5-flash';
const TOP_K = 30;
const MAX_CONTEXT_CHARS = 12_000;

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

export interface CanonCitation {
  factId: string;
  entity: string;
  claim: string;
  sourceRef: string;
  sourceExcerpt: string | null;
  metricKey: string | null;
  metricValue: string | null;
  signedAt: Date;
  eventHash: string;
}

export interface CanonAnswer {
  /** Natural-language answer with inline [f_...] citations. */
  answer: string;
  /** Confidence the model attaches to its own answer. */
  confidence: 'high' | 'medium' | 'low';
  /** Citations from the answer that resolved to a real retrieved fact. */
  citations: CanonCitation[];
  /** All facts the retrieval step considered (so the UI can show "looked at N"). */
  retrievedCount: number;
  latencyMs: number;
  model: string;
}

const SYSTEM_PROMPT = `You answer business questions using ONLY the signed Canon facts in the user message.

Hard rules:
- Every quantitative claim or named entity in your answer MUST be backed by an inline citation in the form [f_XXXXX] where f_XXXXX is a factId from the list provided.
- DO NOT invent facts not in the list. If the available facts don't answer the question, say so explicitly and suggest a more specific question.
- Be terse. 1–4 sentences. Plain language. No emojis.
- When the question is about a CONFLICT (multiple values for the same metric), surface that explicitly: "two competing values, [f_A] vs [f_B]".
- If the user asks for cryptographic proof / source, point them at the cited factId and remind them they can call canon_cite for the COSE_Sign1 envelope.

Output JSON:
{"answer": string, "citedFactIds": string[], "confidence": "high" | "medium" | "low"}

"citedFactIds" must be a deduplicated list of every f_XXX appearing in "answer". The system will validate them against the retrieved set; ids that don't match get dropped.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING },
    citedFactIds: { type: Type.ARRAY, items: { type: Type.STRING } },
    confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
  },
  required: ['answer', 'citedFactIds', 'confidence'],
} as const;

/**
 * Retrieve top-K facts via the SHARED searchFacts() lib so MCP and the
 * Ask-Canon UI use bit-identical ranking (entity-boost included). Trim
 * by char budget so the Gemini prompt stays under a sensible cap.
 */
async function retrieve(
  userId: string,
  workspace: string,
  question: string,
): Promise<CanonCitation[]> {
  const rows = await searchFacts(userId, question, { workspace, limit: 200 });
  const out: CanonCitation[] = [];
  let chars = 0;
  for (const row of rows) {
    if (out.length >= TOP_K) break;
    const block = row.claim + (row.sourceExcerpt ?? '');
    chars += block.length;
    if (chars > MAX_CONTEXT_CHARS) break;
    out.push({
      factId: row.id,
      entity: row.entity,
      claim: row.claim,
      sourceRef: row.sourceRef,
      sourceExcerpt: row.sourceExcerpt,
      metricKey: row.metricKey,
      metricValue: row.metricValue,
      signedAt: row.signedAt,
      eventHash: row.eventHash,
    });
  }
  return out;
}

export async function askCanon(args: {
  userId: string;
  workspace: string;
  question: string;
}): Promise<CanonAnswer | { error: string }> {
  const t0 = Date.now();
  const q = args.question.trim();
  if (!q) return { error: 'question is required' };

  const candidates = await retrieve(args.userId, args.workspace, q);
  if (candidates.length === 0) {
    return {
      answer:
        'Canon has no active signed facts matching the keywords in your question. ' +
        'Try a more specific noun (entity name, metric like "actual_price", or a value like "Manufacturing").',
      confidence: 'low',
      citations: [],
      retrievedCount: 0,
      latencyMs: Date.now() - t0,
      model: MODEL,
    };
  }

  const factsBlock = candidates
    .map((c, i) => {
      const v = c.metricValue ?? '(no value)';
      const k = c.metricKey ? `${c.metricKey}=` : '';
      const ex = c.sourceExcerpt
        ? c.sourceExcerpt.replace(/\s+/g, ' ').trim().slice(0, 180)
        : '';
      return [
        `#${i + 1} factId=${c.factId}`,
        `   entity=${c.entity} ${k}${v}`,
        `   claim=${c.claim}`,
        `   source=${c.sourceRef}`,
        ex ? `   excerpt="${ex}"` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  const userPrompt = [
    `QUESTION: ${q}`,
    '',
    `AVAILABLE SIGNED FACTS (${candidates.length}):`,
    '',
    factsBlock,
  ].join('\n');

  const ai = getAi();

  // Hard 25s budget — Vertex AI on Railway has cold-starts that occasionally
  // stretch past 60s, which would silently leave the UI spinner armed
  // forever. Promise.race surfaces a deterministic error the UI can render.
  const timeoutMs = 25_000;
  let parsed: { answer: string; citedFactIds: string[]; confidence: 'high' | 'medium' | 'low' };
  try {
    const res = await Promise.race([
      ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Gemini timeout after ${timeoutMs / 1000}s — try a shorter question`)),
          timeoutMs,
        ),
      ),
    ]);
    parsed = JSON.parse(res.text ?? '');
  } catch (e) {
    return { error: (e as Error).message || 'Gemini call failed' };
  }

  // Filter cited ids against retrieved set so the UI never renders a link
  // to a fact the model hallucinated.
  const validIds = new Set(candidates.map((c) => c.factId));
  const goodCitations = parsed.citedFactIds
    .filter((id) => validIds.has(id))
    .map((id) => candidates.find((c) => c.factId === id)!)
    .filter(Boolean);

  return {
    answer: parsed.answer,
    confidence: parsed.confidence,
    citations: goodCitations,
    retrievedCount: candidates.length,
    latencyMs: Date.now() - t0,
    model: MODEL,
  };
}
