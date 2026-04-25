/**
 * Canon Trust Pipeline orchestrator.
 *
 * One entrypoint, one pass per source: drafts in → signed FactEvent rows out.
 *
 *   Pioneer (Layer 1, already done in adapters)
 *     → Gemini audit (Layer 2)        — long-context confirm/contradict
 *     → local scan + Aikido banner    (Layer 3) — refuse to canonize secrets/PII
 *     → canon-signer NDJSON IPC       (Layer 4) — Ed25519 + COSE_Sign1, hash-chained
 *     → persist FactEvent in Prisma   — single user-scoped audit chain
 *
 * Conflict detection is downstream (conflicts.ts) — runs after persistence.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { FactDraft } from './types';
import { CanonSigner } from './sign';
import { scanDraft, type ScanResult } from './scan';
import { auditBatch, type AuditVerdict } from './audit';

export type PipelineStatus = 'active' | 'redacted' | 'superseded';

export interface PipelineOutcome {
  factId: string;
  status: PipelineStatus;
  eventHash: string;
  /** Tail-of-chain hash after this event — caller chains the next sign on it. */
  parentHashForNext: string;
  notes?: string;
}

export interface PipelineRunInput {
  userId: string;
  drafts: FactDraft[];
  /** Full source body — fed to Gemini auditor as long-context. */
  context: string;
  /** Free-form label, e.g. "Slack #sales (10 messages)". */
  contextLabel: string;
  /** Reuse a long-lived signer across batches. Pipeline will spawn one if omitted. */
  signer?: CanonSigner;
  /** Skip Gemini call (offline / quota-budget mode). Defaults to false. */
  skipAudit?: boolean;
}

export interface PipelineRunResult {
  outcomes: PipelineOutcome[];
  active: number;
  redacted: number;
  superseded: number;
}

export async function runPipeline(input: PipelineRunInput): Promise<PipelineRunResult> {
  const { userId, drafts, context, contextLabel, skipAudit = false } = input;
  const ownsSigner = !input.signer;
  const signer = input.signer ?? new CanonSigner();
  signer.start();

  // Audit decisions are independent of scan outcomes; compute up-front in parallel.
  const verdicts: AuditVerdict[] = skipAudit
    ? drafts.map(() => ({ confirmed: true, confidence: 0 }))
    : await auditBatch(drafts, context, contextLabel);

  // Hash-chain head: tail eventHash for the user, or empty for genesis.
  let parentHash = await fetchTailEventHash(userId);

  const outcomes: PipelineOutcome[] = [];
  let active = 0;
  let redacted = 0;
  let superseded = 0;

  try {
    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i];
      const verdict = verdicts[i];
      const scan = scanDraft(draft.claim, draft.sourceExcerpt);
      const decision = decide(scan, verdict);

      const factId = `f_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const claimToSign = decision.status === 'redacted' ? '<redacted>' : draft.claim;
      const excerptToSign =
        decision.status === 'redacted' ? '<redacted>' : draft.sourceExcerpt;

      const signRes = await signer.sign({
        factId,
        entity: draft.entity,
        claim: claimToSign,
        sourceRef: draft.sourceRef,
        sourceExcerpt: excerptToSign,
        parentHash,
        createdAtMs: Date.now(),
      });

      await prisma.factEvent.create({
        data: {
          id: factId,
          userId,
          entity: draft.entity,
          claim: claimToSign,
          metricKey: draft.metric?.key ?? null,
          metricValue: draft.metric?.value ?? null,
          metricUnit: draft.metric?.unit ?? null,
          sourceRef: draft.sourceRef,
          sourceExcerpt: excerptToSign,
          parentHash: parentHash || null,
          eventHash: signRes.eventHash,
          coseSign1Hex: signRes.coseSign1Hex,
          signerPubkey: signRes.signerPubkey,
          signedAt: new Date(signRes.signedAtMs),
          observedAt: parseObserved(draft.observedAt),
          status: decision.status,
          notes: decision.notes ?? null,
        },
      });

      outcomes.push({
        factId,
        status: decision.status,
        eventHash: signRes.eventHash,
        parentHashForNext: signRes.eventHash,
        notes: decision.notes,
      });
      parentHash = signRes.eventHash;

      if (decision.status === 'active') active++;
      else if (decision.status === 'redacted') redacted++;
      else superseded++;
    }
  } finally {
    if (ownsSigner) await signer.close();
  }

  return { outcomes, active, redacted, superseded };
}

function decide(
  scan: ScanResult,
  verdict: AuditVerdict,
): { status: PipelineStatus; notes?: string } {
  if (!scan.cleared) {
    return {
      status: 'redacted',
      notes: `redaction:${scan.redactionReason ?? 'unknown'}`,
    };
  }
  if (!verdict.confirmed && verdict.contradiction) {
    return {
      status: 'superseded',
      notes: `audit:${verdict.contradiction.slice(0, 240)}`,
    };
  }
  return { status: 'active' };
}

async function fetchTailEventHash(userId: string): Promise<string> {
  const tail = await prisma.factEvent.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { eventHash: true },
  });
  return tail?.eventHash ?? '';
}

function parseObserved(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
