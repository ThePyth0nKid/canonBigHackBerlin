/**
 * /decide chain writers — Stage 1 (ask source-authors), Stage 1.5
 * (record author response), Stage 2 (escalate to authority), Stage 2.5
 * (authority resolves).
 *
 * Mirrors the resolve.ts pattern verbatim:
 *   1. Auth + workspace lookup off the conflicting facts
 *   2. Fetch tail eventHash for parent_hash chaining
 *   3. CanonSigner.sign() — Ed25519 + COSE_Sign1
 *   4. Single $transaction: factEvent.create + (where applicable) updateMany
 *
 * Every event sits in the same hash-chain as ingest/resolution events.
 * Discrimination is by `sourceRef` prefix and `notes` payload — no schema
 * change. Status stays 'active' for ask/response/escalation; final
 * resolution flips to 'resolution' (matches the existing /app filter).
 */

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { CanonSigner } from '@/lib/canon/sign';
import {
  emailForRole,
  parseSourceAuthor,
  routeMetricToRole,
  type EscalationRole,
} from '@/lib/canon/escalation-policy';

interface SignedWritePrelude {
  workspace: string;
  parentHash: string;
}

async function preludeFromFact(
  userId: string,
  factId: string,
): Promise<SignedWritePrelude | null> {
  const fact = await prisma.factEvent.findFirst({
    where: { id: factId, userId },
    select: { workspace: true },
  });
  if (!fact) return null;
  const tail = await prisma.factEvent.findFirst({
    where: { userId, workspace: fact.workspace },
    orderBy: { signedAt: 'desc' },
    select: { eventHash: true },
  });
  return { workspace: fact.workspace, parentHash: tail?.eventHash ?? '' };
}

async function refreshTail(userId: string, workspace: string): Promise<string> {
  const tail = await prisma.factEvent.findFirst({
    where: { userId, workspace },
    orderBy: { signedAt: 'desc' },
    select: { eventHash: true },
  });
  return tail?.eventHash ?? '';
}

function newThreadId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function newFactId(prefix: string): string {
  return `f_${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

// ============================================================
// Stage 1: askSourceAuthors
// ============================================================

export interface AskSourceAuthorsArgs {
  userId: string;
  entity: string;
  metricKey: string;
  /** The conflicting fact IDs whose authors should be pinged. */
  conflictFactIds: string[];
}

export interface Addressee {
  factId: string;
  kind: 'slack' | 'gmail';
  id: string;
}

export interface AskSourceAuthorsResult {
  ok: boolean;
  threadId?: string;
  askFactId?: string;
  addressees?: Addressee[];
  reason?: string;
}

export async function askSourceAuthors(
  args: AskSourceAuthorsArgs,
): Promise<AskSourceAuthorsResult> {
  const { userId, entity, metricKey, conflictFactIds } = args;
  if (conflictFactIds.length < 2) {
    return { ok: false, reason: 'need at least 2 conflicting facts' };
  }

  const facts = await prisma.factEvent.findMany({
    where: { id: { in: conflictFactIds }, userId, status: 'active' },
    select: {
      id: true,
      workspace: true,
      sourceRef: true,
      metricValue: true,
    },
  });
  if (facts.length < 2) return { ok: false, reason: 'facts not found' };
  const workspace = facts[0].workspace;
  if (facts.some((f) => f.workspace !== workspace)) {
    return { ok: false, reason: 'cross-workspace conflict' };
  }

  // Idempotency: if there's an open ask thread for this (entity, metricKey)
  // with no resolution event yet, return it instead of writing a duplicate.
  const open = await findOpenThread(userId, workspace, entity, metricKey);
  if (open) {
    return { ok: true, threadId: open.threadId, askFactId: open.askFactId };
  }

  const threadId = newThreadId();
  const addressees: Addressee[] = facts
    .map((f) => {
      const a = parseSourceAuthor(f.sourceRef);
      return a ? { factId: f.id, kind: a.kind, id: a.id } : null;
    })
    .filter((x): x is Addressee => x !== null);

  if (addressees.length === 0) {
    return {
      ok: false,
      reason:
        'no_human_authors: this conflict only has automated sources (Slack/Gmail authors absent). Use Escalate Directly to route to the policy authority.',
    };
  }
  // Partial-author tolerance: some sources have humans, some don't.
  // We ping the humans we have; the audit trail records which were unaskable.
  const unaskable = facts
    .filter((f) => !addressees.some((a) => a.factId === f.id))
    .map((f) => f.id);

  const parentHash = await refreshTail(userId, workspace);
  const askFactId = newFactId('ask');
  const claim = `Clarification request: ${entity}.${metricKey} — competing claims (${facts
    .map((f) => f.metricValue ?? '?')
    .join(' vs ')}). Pinged ${addressees.length} of ${facts.length} candidate source(s)${unaskable.length > 0 ? ` — ${unaskable.length} automated source(s) had no human author` : ''}.`;
  const sourceRef = `decide:ask:${threadId}`;
  const notes = [
    `decide:thread=${threadId}`,
    `stage=asked`,
    `metricKey=${metricKey}`,
    `entity=${entity}`,
    `conflictFacts=${conflictFactIds.join(',')}`,
    `addressees=${addressees.map((a) => `${a.kind}:${a.id}`).join(',')}`,
    unaskable.length > 0 ? `unaskable=${unaskable.join(',')}` : 'unaskable=',
  ].join(':');

  const signer = new CanonSigner();
  signer.start();
  let signRes;
  try {
    signRes = await signer.sign({
      factId: askFactId,
      entity,
      claim,
      sourceRef,
      sourceExcerpt: claim,
      parentHash,
      createdAtMs: Date.now(),
    });
  } finally {
    await signer.close();
  }

  await prisma.factEvent.create({
    data: {
      id: askFactId,
      userId,
      workspace,
      entity,
      claim,
      metricKey,
      metricValue: null,
      metricUnit: null,
      sourceRef,
      sourceExcerpt: claim,
      parentHash: parentHash || null,
      eventHash: signRes.eventHash,
      coseSign1Hex: signRes.coseSign1Hex,
      signerPubkey: signRes.signerPubkey,
      signedAt: new Date(signRes.signedAtMs),
      observedAt: new Date(),
      status: 'active',
      notes,
    },
  });

  revalidatePath('/decide');
  revalidatePath('/app');
  return { ok: true, threadId, askFactId, addressees };
}

// ============================================================
// Stage 1.5: recordResponse
// ============================================================

export type ResponseChoice = 'mine_stands' | 'theirs_stands' | 'neither';

export interface RecordResponseArgs {
  /** Workspace-owner userId (the owner of the ledger we're writing into). */
  userId: string;
  /**
   * Logical responder identity. For the demo this is whatever addressee the
   * UI selected ("answer as Alice"); the actual session can be the workspace
   * owner. The response event's `notes.by` records this logical identity for
   * the audit trail. Must match one of the thread addressees.
   */
  responderEmail: string;
  threadId: string;
  choice: ResponseChoice;
  /** Required when choice === 'mine_stands' or 'theirs_stands'. */
  chosenFactId?: string;
}

export interface RecordResponseResult {
  ok: boolean;
  responseFactId?: string;
  resolutionFactId?: string;
  consensus?: 'reached' | 'pending' | 'diverged';
  reason?: string;
}

export async function recordResponse(
  args: RecordResponseArgs,
): Promise<RecordResponseResult> {
  const { userId, responderEmail, threadId, choice, chosenFactId } = args;

  const askFact = await findAskFact(userId, threadId);
  if (!askFact) return { ok: false, reason: 'thread not found' };
  const meta = parseThreadNotes(askFact.notes ?? '');
  if (!meta) return { ok: false, reason: 'malformed thread metadata' };

  const matchedAddressee = meta.addressees.find(
    (a) => a.id.toLowerCase() === responderEmail.toLowerCase(),
  );
  // Slack-author addressees have a Slack user ID, not an email. Demo seed
  // attaches the same User row to both, so we also match by responderEmail
  // appearing in the addressee id list as a stored alias.
  if (!matchedAddressee) {
    return { ok: false, reason: 'responder is not an addressee for this thread' };
  }

  if ((choice === 'mine_stands' || choice === 'theirs_stands') && !chosenFactId) {
    return { ok: false, reason: 'chosenFactId required for mine/theirs choice' };
  }

  const workspace = askFact.workspace;
  const parentHash = await refreshTail(userId, workspace);
  const responseFactId = newFactId('rsp');
  const claim = `Author response (${responderEmail}): ${describeChoice(choice, chosenFactId)} for ${meta.entity}.${meta.metricKey}.`;
  const sourceRef = `decide:response:${threadId}`;
  const notes = [
    `decide:thread=${threadId}`,
    `stage=responded`,
    `by=${responderEmail.toLowerCase()}`,
    `choice=${choice}`,
    chosenFactId ? `chosenFact=${chosenFactId}` : 'chosenFact=',
    `parentAsk=${askFact.id}`,
  ].join(':');

  const signer = new CanonSigner();
  signer.start();
  let signRes;
  try {
    signRes = await signer.sign({
      factId: responseFactId,
      entity: meta.entity,
      claim,
      sourceRef,
      sourceExcerpt: claim,
      parentHash,
      createdAtMs: Date.now(),
    });
  } finally {
    await signer.close();
  }

  await prisma.factEvent.create({
    data: {
      id: responseFactId,
      userId,
      workspace,
      entity: meta.entity,
      claim,
      metricKey: meta.metricKey,
      metricValue: null,
      metricUnit: null,
      sourceRef,
      sourceExcerpt: claim,
      parentHash: parentHash || null,
      eventHash: signRes.eventHash,
      coseSign1Hex: signRes.coseSign1Hex,
      signerPubkey: signRes.signerPubkey,
      signedAt: new Date(signRes.signedAtMs),
      observedAt: new Date(),
      status: 'active',
      notes,
    },
  });

  // Inspect ALL responses for this thread now that ours is persisted.
  const consensus = await evaluateConsensus(userId, workspace, threadId, meta);

  if (consensus.kind === 'reached' && consensus.winnerFactId) {
    const resolutionFactId = await writeConsensusResolution({
      userId,
      workspace,
      threadId,
      meta,
      winnerFactId: consensus.winnerFactId,
    });
    revalidatePath('/decide');
    revalidatePath('/app');
    return {
      ok: true,
      responseFactId,
      resolutionFactId,
      consensus: 'reached',
    };
  }

  revalidatePath('/decide');
  revalidatePath('/app');
  return {
    ok: true,
    responseFactId,
    consensus: consensus.kind === 'diverged' ? 'diverged' : 'pending',
  };
}

function describeChoice(choice: ResponseChoice, chosenFactId?: string): string {
  switch (choice) {
    case 'mine_stands':
      return `confirms own claim (fact ${chosenFactId ?? '?'}) is correct`;
    case 'theirs_stands':
      return `defers to other source (fact ${chosenFactId ?? '?'})`;
    case 'neither':
      return `rejects all candidates as wrong`;
  }
}

// ============================================================
// Stage 2: escalateToAuthority
// ============================================================

export interface EscalateArgs {
  userId: string;
  threadId: string;
}

export interface EscalateResult {
  ok: boolean;
  escalationFactId?: string;
  role?: EscalationRole;
  authorityEmail?: string;
  reason?: string;
}

export async function escalateToAuthority(
  args: EscalateArgs,
): Promise<EscalateResult> {
  const { userId, threadId } = args;
  const askFact = await findAskFact(userId, threadId);
  if (!askFact) return { ok: false, reason: 'thread not found' };
  const meta = parseThreadNotes(askFact.notes ?? '');
  if (!meta) return { ok: false, reason: 'malformed thread metadata' };

  const role = routeMetricToRole(meta.metricKey);
  const authorityEmail = emailForRole(role);
  const workspace = askFact.workspace;
  const parentHash = await refreshTail(userId, workspace);

  const escalationFactId = newFactId('esc');
  const claim = `Escalated to ${role} (${authorityEmail}): ${meta.entity}.${meta.metricKey} — source-authors did not converge.`;
  const sourceRef = `decide:escalation:${threadId}`;
  const notes = [
    `decide:thread=${threadId}`,
    `stage=escalated`,
    `role=${role}`,
    `to=${authorityEmail}`,
  ].join(':');

  const signer = new CanonSigner();
  signer.start();
  let signRes;
  try {
    signRes = await signer.sign({
      factId: escalationFactId,
      entity: meta.entity,
      claim,
      sourceRef,
      sourceExcerpt: claim,
      parentHash,
      createdAtMs: Date.now(),
    });
  } finally {
    await signer.close();
  }

  await prisma.factEvent.create({
    data: {
      id: escalationFactId,
      userId,
      workspace,
      entity: meta.entity,
      claim,
      metricKey: meta.metricKey,
      metricValue: null,
      metricUnit: null,
      sourceRef,
      sourceExcerpt: claim,
      parentHash: parentHash || null,
      eventHash: signRes.eventHash,
      coseSign1Hex: signRes.coseSign1Hex,
      signerPubkey: signRes.signerPubkey,
      signedAt: new Date(signRes.signedAtMs),
      observedAt: new Date(),
      status: 'active',
      notes,
    },
  });

  revalidatePath('/decide');
  revalidatePath('/app');
  return { ok: true, escalationFactId, role, authorityEmail };
}

// ============================================================
// Stage 2 (alt): escalateDirectly — for conflicts whose sources are
// purely automated (qontext catalog, sales data, invoices) and have
// no human author to ask. Skips Stage 1, opens a fresh thread anchored
// on a synthetic ask-skipped event so the chain still walks cleanly.
// ============================================================

export interface EscalateDirectArgs {
  userId: string;
  entity: string;
  metricKey: string;
  conflictFactIds: string[];
}

export async function escalateDirectly(
  args: EscalateDirectArgs,
): Promise<EscalateResult & { threadId?: string }> {
  const { userId, entity, metricKey, conflictFactIds } = args;
  if (conflictFactIds.length < 2) {
    return { ok: false, reason: 'need at least 2 conflicting facts' };
  }

  const facts = await prisma.factEvent.findMany({
    where: { id: { in: conflictFactIds }, userId, status: 'active' },
    select: { id: true, workspace: true, sourceRef: true, metricValue: true },
  });
  if (facts.length < 2) return { ok: false, reason: 'facts not found' };
  const workspace = facts[0].workspace;
  if (facts.some((f) => f.workspace !== workspace)) {
    return { ok: false, reason: 'cross-workspace conflict' };
  }

  // Idempotency: reuse an open thread if one exists for this (entity, metricKey).
  const open = await findOpenThread(userId, workspace, entity, metricKey);
  let threadId = open?.threadId;

  if (!threadId) {
    threadId = newThreadId();
    // Write a synthetic "ask-skipped" event so loadDecisionThread / lineage
    // walks have an anchor with the same shape as a real ask.
    const parentHash = await refreshTail(userId, workspace);
    const askSkippedFactId = newFactId('askSkip');
    const claim = `Ask-source-authors skipped: ${entity}.${metricKey} — all ${facts.length} sources are automated (no human author). Routing straight to authority.`;
    const sourceRef = `decide:ask:${threadId}`;
    const notes = [
      `decide:thread=${threadId}`,
      `stage=asked`,
      `metricKey=${metricKey}`,
      `entity=${entity}`,
      `conflictFacts=${conflictFactIds.join(',')}`,
      `addressees=`,
      `unaskable=${conflictFactIds.join(',')}`,
      `skipped=no_human_authors`,
    ].join(':');
    const signer = new CanonSigner();
    signer.start();
    let signRes;
    try {
      signRes = await signer.sign({
        factId: askSkippedFactId,
        entity,
        claim,
        sourceRef,
        sourceExcerpt: claim,
        parentHash,
        createdAtMs: Date.now(),
      });
    } finally {
      await signer.close();
    }
    await prisma.factEvent.create({
      data: {
        id: askSkippedFactId,
        userId,
        workspace,
        entity,
        claim,
        metricKey,
        metricValue: null,
        metricUnit: null,
        sourceRef,
        sourceExcerpt: claim,
        parentHash: parentHash || null,
        eventHash: signRes.eventHash,
        coseSign1Hex: signRes.coseSign1Hex,
        signerPubkey: signRes.signerPubkey,
        signedAt: new Date(signRes.signedAtMs),
        observedAt: new Date(),
        status: 'active',
        notes,
      },
    });
  }

  // Now write the escalation event — same shape as escalateToAuthority.
  const role = routeMetricToRole(metricKey);
  const authorityEmail = emailForRole(role);
  const parentHash = await refreshTail(userId, workspace);
  const escalationFactId = newFactId('esc');
  const claim = `Escalated to ${role} (${authorityEmail}): ${entity}.${metricKey} — automated sources only, no human consensus possible.`;
  const sourceRef = `decide:escalation:${threadId}`;
  const notes = [
    `decide:thread=${threadId}`,
    `stage=escalated`,
    `role=${role}`,
    `to=${authorityEmail}`,
    `via=direct_escalation`,
  ].join(':');

  const signer = new CanonSigner();
  signer.start();
  let signRes;
  try {
    signRes = await signer.sign({
      factId: escalationFactId,
      entity,
      claim,
      sourceRef,
      sourceExcerpt: claim,
      parentHash,
      createdAtMs: Date.now(),
    });
  } finally {
    await signer.close();
  }

  await prisma.factEvent.create({
    data: {
      id: escalationFactId,
      userId,
      workspace,
      entity,
      claim,
      metricKey,
      metricValue: null,
      metricUnit: null,
      sourceRef,
      sourceExcerpt: claim,
      parentHash: parentHash || null,
      eventHash: signRes.eventHash,
      coseSign1Hex: signRes.coseSign1Hex,
      signerPubkey: signRes.signerPubkey,
      signedAt: new Date(signRes.signedAtMs),
      observedAt: new Date(),
      status: 'active',
      notes,
    },
  });

  revalidatePath('/decide');
  revalidatePath('/app');
  return { ok: true, escalationFactId, role, authorityEmail, threadId };
}

// ============================================================
// Stage 2.5: resolveByAuthority
// ============================================================

export interface ResolveByAuthorityArgs {
  userId: string;
  authorityEmail: string;
  threadId: string;
  winnerFactId: string;
}

export interface ResolveByAuthorityResult {
  ok: boolean;
  resolutionFactId?: string;
  superseded?: number;
  reason?: string;
}

export async function resolveByAuthority(
  args: ResolveByAuthorityArgs,
): Promise<ResolveByAuthorityResult> {
  const { userId, authorityEmail, threadId, winnerFactId } = args;
  const askFact = await findAskFact(userId, threadId);
  if (!askFact) return { ok: false, reason: 'thread not found' };
  const meta = parseThreadNotes(askFact.notes ?? '');
  if (!meta) return { ok: false, reason: 'malformed thread metadata' };

  // Authority gate: in V1, the workspace owner is implicitly trusted to act
  // as any role (single-tenant demo workspace). The audit trail records the
  // logical role (`role=<expectedRole>`) regardless of session identity, so
  // canon_cite still shows "resolved by cfo" even when the workspace owner
  // clicked. Real RBAC is V2.
  const expectedRole = routeMetricToRole(meta.metricKey);
  const expectedEmail = emailForRole(expectedRole);

  const winner = await prisma.factEvent.findFirst({
    where: { id: winnerFactId, userId, workspace: askFact.workspace },
    select: { id: true, metricValue: true, metricUnit: true, entity: true, metricKey: true },
  });
  if (!winner) return { ok: false, reason: 'winner fact not found in thread workspace' };

  const losers = (meta.conflictFactIds ?? []).filter((id) => id !== winnerFactId);
  return writeFinalResolution({
    userId,
    workspace: askFact.workspace,
    threadId,
    meta,
    winnerFactId,
    winnerValue: winner.metricValue ?? null,
    winnerUnit: winner.metricUnit ?? null,
    loserIds: losers,
    by: `${expectedRole}:${expectedEmail}`,
    via: 'authority_pick',
  });
}

// ============================================================
// Internal helpers
// ============================================================

interface ThreadMeta {
  threadId: string;
  entity: string;
  metricKey: string;
  conflictFactIds: string[];
  addressees: { kind: string; id: string }[];
}

function parseThreadNotes(notes: string): ThreadMeta | null {
  // notes shape: "decide:thread=<id>:stage=...:metricKey=...:entity=...:conflictFacts=a,b:addressees=slack:U07,gmail:bob@x.com"
  // The addressees value contains colons (`slack:U07`) so we hand-roll a parser
  // instead of split(':').
  const threadIdMatch = notes.match(/decide:thread=([A-Za-z0-9]+)/);
  const entityMatch = notes.match(/(?:^|:)entity=([^:]+)/);
  const metricKeyMatch = notes.match(/(?:^|:)metricKey=([^:]+)/);
  const conflictFactsMatch = notes.match(/(?:^|:)conflictFacts=([^:]+)/);
  const addresseesMatch = notes.match(/(?:^|:)addressees=(.+)$/);

  if (!threadIdMatch || !entityMatch || !metricKeyMatch) return null;
  const conflictFactIds = conflictFactsMatch
    ? conflictFactsMatch[1].split(',').filter(Boolean)
    : [];
  const addressees = addresseesMatch
    ? addresseesMatch[1]
        .split(',')
        .map((s) => {
          const [kind, ...rest] = s.split(':');
          const id = rest.join(':');
          if (!kind || !id) return null;
          return { kind, id };
        })
        .filter((x): x is { kind: string; id: string } => x !== null)
    : [];

  return {
    threadId: threadIdMatch[1],
    entity: entityMatch[1],
    metricKey: metricKeyMatch[1],
    conflictFactIds,
    addressees,
  };
}

async function findAskFact(userId: string, threadId: string) {
  return prisma.factEvent.findFirst({
    where: { userId, sourceRef: `decide:ask:${threadId}` },
    select: {
      id: true,
      workspace: true,
      entity: true,
      metricKey: true,
      notes: true,
      eventHash: true,
    },
  });
}

interface OpenThreadRef {
  threadId: string;
  askFactId: string;
}

async function findOpenThread(
  userId: string,
  workspace: string,
  entity: string,
  metricKey: string,
): Promise<OpenThreadRef | null> {
  const candidates = await prisma.factEvent.findMany({
    where: {
      userId,
      workspace,
      entity,
      metricKey,
      sourceRef: { startsWith: 'decide:ask:' },
    },
    select: { id: true, sourceRef: true },
    orderBy: { signedAt: 'desc' },
    take: 5,
  });
  for (const c of candidates) {
    const threadId = c.sourceRef.replace('decide:ask:', '');
    const resolved = await prisma.factEvent.findFirst({
      where: { userId, workspace, sourceRef: `decide:resolution:${threadId}` },
      select: { id: true },
    });
    if (!resolved) return { threadId, askFactId: c.id };
  }
  return null;
}

interface ConsensusResult {
  kind: 'reached' | 'pending' | 'diverged';
  winnerFactId?: string;
}

async function evaluateConsensus(
  userId: string,
  workspace: string,
  threadId: string,
  meta: ThreadMeta,
): Promise<ConsensusResult> {
  const responses = await prisma.factEvent.findMany({
    where: {
      userId,
      workspace,
      sourceRef: `decide:response:${threadId}`,
    },
    select: { notes: true },
  });
  if (responses.length < meta.addressees.length) {
    return { kind: 'pending' };
  }
  // Each response notes: choice=...:chosenFact=...
  const picks = responses
    .map((r) => {
      const choice = r.notes?.match(/(?:^|:)choice=([^:]+)/)?.[1];
      const chosen = r.notes?.match(/(?:^|:)chosenFact=([^:]*)/)?.[1] || null;
      return { choice, chosen };
    })
    .filter((p) => p.choice && p.choice !== 'neither');

  // Convergence: every (non-neither) responder pointed at the same chosenFact.
  const choices = new Set(picks.map((p) => p.chosen));
  if (
    picks.length === responses.length &&
    choices.size === 1 &&
    [...choices][0] !== null &&
    [...choices][0] !== ''
  ) {
    return { kind: 'reached', winnerFactId: [...choices][0] as string };
  }
  return { kind: 'diverged' };
}

async function writeConsensusResolution(args: {
  userId: string;
  workspace: string;
  threadId: string;
  meta: ThreadMeta;
  winnerFactId: string;
}): Promise<string> {
  const { userId, workspace, threadId, meta, winnerFactId } = args;
  const winner = await prisma.factEvent.findFirst({
    where: { id: winnerFactId, userId, workspace },
    select: { metricValue: true, metricUnit: true },
  });
  const loserIds = meta.conflictFactIds.filter((id) => id !== winnerFactId);
  const result = await writeFinalResolution({
    userId,
    workspace,
    threadId,
    meta,
    winnerFactId,
    winnerValue: winner?.metricValue ?? null,
    winnerUnit: winner?.metricUnit ?? null,
    loserIds,
    by: 'source-author-consensus',
    via: 'author_consensus',
  });
  return result.resolutionFactId ?? '';
}

async function writeFinalResolution(args: {
  userId: string;
  workspace: string;
  threadId: string;
  meta: ThreadMeta;
  winnerFactId: string;
  winnerValue: string | null;
  winnerUnit: string | null;
  loserIds: string[];
  by: string;
  via: 'author_consensus' | 'authority_pick';
}): Promise<ResolveByAuthorityResult> {
  const { userId, workspace, threadId, meta, winnerFactId, winnerValue, winnerUnit, loserIds, by, via } = args;
  const parentHash = await refreshTail(userId, workspace);
  const resolutionFactId = newFactId('rdec');
  const claim = `Resolution (${via}): ${meta.entity}.${meta.metricKey} = ${winnerValue ?? '(no value)'} — by ${by}, supersedes ${loserIds.length} alternative${loserIds.length === 1 ? '' : 's'}.`;
  const sourceRef = `decide:resolution:${threadId}`;
  const notes = [
    `decide:thread=${threadId}`,
    `stage=resolved`,
    `via=${via}`,
    `by=${by}`,
    `winner=${winnerFactId}`,
    `losers=${loserIds.join(',')}`,
  ].join(':');

  const signer = new CanonSigner();
  signer.start();
  let signRes;
  try {
    signRes = await signer.sign({
      factId: resolutionFactId,
      entity: meta.entity,
      claim,
      sourceRef,
      sourceExcerpt: claim,
      parentHash,
      createdAtMs: Date.now(),
    });
  } finally {
    await signer.close();
  }

  await prisma.$transaction([
    prisma.factEvent.create({
      data: {
        id: resolutionFactId,
        userId,
        workspace,
        entity: meta.entity,
        claim,
        metricKey: meta.metricKey,
        metricValue: winnerValue,
        metricUnit: winnerUnit,
        sourceRef,
        sourceExcerpt: claim,
        parentHash: parentHash || null,
        eventHash: signRes.eventHash,
        coseSign1Hex: signRes.coseSign1Hex,
        signerPubkey: signRes.signerPubkey,
        signedAt: new Date(signRes.signedAtMs),
        observedAt: new Date(),
        status: 'resolution',
        notes,
      },
    }),
    prisma.factEvent.updateMany({
      where: { id: { in: loserIds } },
      data: {
        status: 'superseded',
        notes: `superseded:decide-${via}:${signRes.eventHash}`,
      },
    }),
  ]);

  return { ok: true, resolutionFactId, superseded: loserIds.length };
}

// Re-export for callers that want the prelude helper without new files.
export { preludeFromFact };
