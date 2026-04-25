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

export type PipelineProgress =
  | { phase: 'audit'; done: number; total: number }
  | { phase: 'sign'; done: number; total: number; entity: string };

export interface PipelineRunInput {
  userId: string;
  drafts: FactDraft[];
  /** Full source body — fed to Gemini auditor as long-context. */
  context: string;
  /** Free-form label, e.g. "Slack #sales (10 messages)". */
  contextLabel: string;
  /**
   * Workspace tag — every FactEvent persisted by this run lands in this
   * workspace. Default 'northwind' for backward compatibility with the
   * existing sync flow; the Qontext-dataset ingest passes 'inazuma'.
   */
  workspace?: string;
  /** Reuse a long-lived signer across batches. Pipeline will spawn one if omitted. */
  signer?: CanonSigner;
  /** Skip Gemini call (offline / quota-budget mode). Defaults to false. */
  skipAudit?: boolean;
  /**
   * Optional progress callback. Called per-fact during signing so the UI
   * can show a streaming progress bar. Errors thrown by the callback are
   * caught and ignored — never breaks the pipeline.
   */
  onProgress?: (event: PipelineProgress) => void;
}

export interface PipelineRunResult {
  outcomes: PipelineOutcome[];
  active: number;
  redacted: number;
  superseded: number;
}

export async function runPipeline(input: PipelineRunInput): Promise<PipelineRunResult> {
  const {
    userId,
    drafts,
    context,
    contextLabel,
    skipAudit = false,
    workspace = 'northwind',
    onProgress,
  } = input;
  const emit = (event: PipelineProgress) => {
    if (!onProgress) return;
    try {
      onProgress(event);
    } catch {
      // never let a UI callback break the pipeline.
    }
  };
  const ownsSigner = !input.signer;
  const signer = input.signer ?? new CanonSigner();
  signer.start();

  // Audit decisions are independent of scan outcomes; compute up-front in parallel.
  emit({ phase: 'audit', done: 0, total: drafts.length });
  const verdicts: AuditVerdict[] = skipAudit
    ? drafts.map(() => ({ confirmed: true, confidence: 0 }))
    : await auditBatch(drafts, context, contextLabel);
  emit({ phase: 'audit', done: drafts.length, total: drafts.length });

  // Hash-chain head: per-workspace tail eventHash, empty for genesis. Each
  // workspace gets its own chain so cross-workspace order doesn't mix.
  let parentHash = await fetchTailEventHash(userId, workspace);

  const outcomes: PipelineOutcome[] = [];
  let active = 0;
  let redacted = 0;
  let superseded = 0;

  let signFailures = 0;
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

      let signRes;
      try {
        signRes = await signer.sign({
          factId,
          entity: draft.entity,
          claim: claimToSign,
          sourceRef: draft.sourceRef,
          sourceExcerpt: excerptToSign,
          parentHash,
          createdAtMs: Date.now(),
        });
      } catch (err) {
        // Sign failure must not corrupt the chain: skip persistence, keep
        // parentHash anchored on the previous successful event, and mark the
        // draft as a known-failed outcome so the orchestrator can surface it.
        signFailures++;
        outcomes.push({
          factId,
          status: 'superseded',
          eventHash: '',
          parentHashForNext: parentHash,
          notes: `sign_failed:${truncate((err as Error).message, 160)}`,
        });
        continue;
      }

      await prisma.factEvent.create({
        data: {
          id: factId,
          userId,
          workspace,
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
      emit({
        phase: 'sign',
        done: i + 1,
        total: drafts.length,
        entity: draft.entity,
      });
    }
  } finally {
    if (ownsSigner) await signer.close();
  }
  if (signFailures > 0) superseded += signFailures;

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

async function fetchTailEventHash(userId: string, workspace: string): Promise<string> {
  const tail = await prisma.factEvent.findFirst({
    where: { userId, workspace },
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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
