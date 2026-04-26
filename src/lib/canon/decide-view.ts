/**
 * Read helpers backing the /decide page.
 *
 * Three queries, each tightly scoped to keep the inbox <500ms even on
 * the inazuma workspace's ~8800 facts:
 *   - loadDecisionInbox: open conflicts + their thread-state, if any
 *   - loadMyAuthorAsks:  asks where the signed-in user is an addressee
 *   - loadDecisionThread: full chain for one thread (for the proof view)
 */

import { prisma } from '@/lib/prisma';
import {
  emailForRole,
  parseSourceAuthor,
  routeMetricToRole,
  type EscalationRole,
} from '@/lib/canon/escalation-policy';
import {
  loadFactLandscape,
  type EntityGroup,
  type FactRow,
  type MetricGroup,
} from '@/lib/canon/view';

export type DecisionStage =
  | 'fresh'
  | 'asked'
  | 'partial_response'
  | 'consensus'
  | 'diverged'
  | 'escalated'
  | 'resolved';

export interface DecisionThreadState {
  threadId: string;
  askFactId: string;
  stage: DecisionStage;
  addressees: { kind: 'slack' | 'gmail'; id: string }[];
  responses: { by: string; choice: string; chosenFactId: string | null }[];
  escalation?: { role: EscalationRole; authorityEmail: string };
  resolution?: { winnerFactId: string; winnerValue: string | null; via: string };
}

export interface DecisionCard {
  entity: string;
  entityDisplay: string;
  metricKey: string;
  metricLabel: string;
  /** Active facts that are competing — the conflict candidates. */
  candidates: FactRow[];
  thread: DecisionThreadState | null;
  /** The role this metric escalates to under current policy. */
  escalationRole: EscalationRole;
  authorityEmail: string;
  /**
   * How many of the candidate sources expose a human author in their sourceRef.
   * Drives whether "Ask source-authors" or "Escalate directly" is the right CTA.
   */
  authorAvailability: 'all' | 'partial' | 'none';
  authorCount: number;
  totalCandidates: number;
}

export interface DecisionInbox {
  cards: DecisionCard[];
  /** Total open count for badge display. */
  count: number;
  /** Asks where the current user is on the addressee list. */
  myAsks: AuthorAsk[];
}

export interface AuthorAsk {
  threadId: string;
  askFactId: string;
  entity: string;
  metricKey: string;
  candidateFactIds: string[];
  candidates: { factId: string; value: string | null; sourceKind: string }[];
  /** Every addressee on the thread — UI renders one chip per. */
  addressees: { kind: 'slack' | 'gmail'; id: string }[];
  /** Convenience: first addressee, kept for any callers that want one. */
  myMatchedAddressee: { kind: 'slack' | 'gmail'; id: string };
}

interface ThreadEventBrief {
  id: string;
  sourceRef: string;
  notes: string | null;
  signedAt: Date;
  metricValue: string | null;
  status: string;
}

/**
 * Fast count of open decisions for the TopBar badge.
 *
 * One SQL aggregation: count distinct (entity, metricKey) pairs where the
 * active facts span more than one distinct metricValue. That's the same
 * "needsHumanResolve" definition `buildMetricGroup` uses, but computed
 * server-side without walking the 8800-row landscape into Node memory.
 *
 * Result matches inbox.count (the number of cards visible on /decide), so
 * the TopBar badge and the visible cards stay consistent — clicking
 * "Decide" on a card decrements the badge live (resolution event flips
 * losers to status='superseded', the GROUP BY drops them, count drops by 1).
 */
export async function loadDecisionBadge(
  userId: string,
  workspace: string = 'inazuma',
): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT 1 FROM "FactEvent"
      WHERE "userId" = ${userId}
        AND "workspace" = ${workspace}
        AND "status" = 'active'
        AND "metricKey" IS NOT NULL
      GROUP BY "entity", "metricKey"
      HAVING COUNT(DISTINCT "metricValue") > 1
    ) AS conflicts;
  `;
  const c = rows[0]?.count;
  return c === undefined ? 0 : Number(c);
}

export async function loadDecisionInbox(
  userId: string,
  workspace: string = 'inazuma',
  userEmail?: string | null,
): Promise<DecisionInbox> {
  const landscape = await loadFactLandscape(userId, workspace);

  const openMetrics: { entity: EntityGroup; metric: MetricGroup }[] = [];
  for (const e of landscape.entities) {
    for (const m of e.metrics) {
      if (m.needsHumanResolve) openMetrics.push({ entity: e, metric: m });
    }
  }

  const threadEvents = await prisma.factEvent.findMany({
    where: {
      userId,
      workspace,
      sourceRef: { startsWith: 'decide:' },
    },
    select: {
      id: true,
      sourceRef: true,
      notes: true,
      signedAt: true,
      metricValue: true,
      status: true,
    },
    orderBy: { signedAt: 'asc' },
  });

  // Group events by threadId (extracted from sourceRef like decide:KIND:THREAD).
  // Then resolve each thread to (entity, metricKey) via its ask event's notes —
  // ask is the only stage that carries the full thread metadata. Earlier
  // versions grouped by (entity, metricKey) read from each event's notes,
  // which silently dropped escalation/response/resolution events whose notes
  // don't repeat the thread metadata. That made click-through stages invisible.
  const byThread = new Map<string, ThreadEventBrief[]>();
  for (const ev of threadEvents) {
    const m = ev.sourceRef.match(/^decide:[^:]+:(.+)$/);
    if (!m) continue;
    const threadId = m[1];
    if (!byThread.has(threadId)) byThread.set(threadId, []);
    byThread.get(threadId)!.push(ev);
  }

  const byEntityMetric = new Map<string, ThreadEventBrief[]>();
  for (const [, events] of byThread) {
    const ask = events.find((e) => e.sourceRef.startsWith('decide:ask:'));
    if (!ask) continue;
    const meta = parseNotes(ask.notes ?? '');
    if (!meta?.entity || !meta?.metricKey) continue;
    const k = `${meta.entity}::${meta.metricKey}`;
    if (!byEntityMetric.has(k)) byEntityMetric.set(k, []);
    byEntityMetric.get(k)!.push(...events);
  }

  const cards: DecisionCard[] = [];
  for (const { entity, metric } of openMetrics) {
    const k = `${entity.slug}::${metric.key}`;
    const events = byEntityMetric.get(k) ?? [];
    const thread = buildThreadState(events);
    if (thread?.stage === 'resolved') continue; // already done

    const role = routeMetricToRole(metric.key);
    const authorCount = metric.active.filter(
      (f) => parseSourceAuthor(f.sourceRef) !== null,
    ).length;
    const total = metric.active.length;
    const authorAvailability: 'all' | 'partial' | 'none' =
      authorCount === 0 ? 'none' : authorCount === total ? 'all' : 'partial';
    cards.push({
      entity: entity.slug,
      entityDisplay: entity.displayName,
      metricKey: metric.key,
      metricLabel: metric.label,
      candidates: metric.active,
      thread,
      escalationRole: role,
      authorityEmail: emailForRole(role),
      authorAvailability,
      authorCount,
      totalCandidates: total,
    });
  }

  // Sort: cards with active threads first (interesting for demo), then by
  // author availability ('all' > 'partial' > 'none'). Authored cards rank
  // top so the audience hits the working ask-source-authors path first.
  cards.sort((a, b) => {
    const stageDiff = stageRank(b.thread?.stage) - stageRank(a.thread?.stage);
    if (stageDiff !== 0) return stageDiff;
    return authorRank(b.authorAvailability) - authorRank(a.authorAvailability);
  });

  // myAsks is populated by the caller via loadOpenAuthorAsks on the page;
  // we leave it empty here so the inbox query stays a single round-trip.
  void userEmail;
  return { cards, count: cards.length, myAsks: [] };
}

function authorRank(a: 'all' | 'partial' | 'none'): number {
  return a === 'all' ? 2 : a === 'partial' ? 1 : 0;
}

function stageRank(stage: DecisionStage | undefined): number {
  switch (stage) {
    case 'escalated':
      return 5;
    case 'diverged':
      return 4;
    case 'partial_response':
      return 3;
    case 'asked':
      return 2;
    case 'fresh':
    case undefined:
      return 1;
    case 'consensus':
    case 'resolved':
      return 0;
  }
}

function buildThreadState(
  events: ThreadEventBrief[],
): DecisionThreadState | null {
  if (events.length === 0) return null;
  const ask = events.find((e) => e.sourceRef.startsWith('decide:ask:'));
  if (!ask) return null;
  const meta = parseNotes(ask.notes ?? '');
  if (!meta?.threadId) return null;
  const threadId = meta.threadId;

  const myEvents = events.filter((e) => e.sourceRef.includes(threadId));
  const responses = myEvents
    .filter((e) => e.sourceRef.startsWith('decide:response:'))
    .map((e) => {
      const m = parseNotes(e.notes ?? '');
      return {
        by: m?.by ?? '?',
        choice: m?.choice ?? '?',
        chosenFactId: m?.chosenFact || null,
      };
    });
  const escalation = myEvents.find((e) =>
    e.sourceRef.startsWith('decide:escalation:'),
  );
  const resolution = myEvents.find((e) =>
    e.sourceRef.startsWith('decide:resolution:'),
  );

  let stage: DecisionStage = 'asked';
  if (resolution) stage = 'resolved';
  else if (escalation) stage = 'escalated';
  else if (responses.length === 0) stage = 'asked';
  else if (responses.length < (meta.addressees?.length ?? 999))
    stage = 'partial_response';
  else {
    const picks = responses.filter((r) => r.choice !== 'neither');
    const distinctChosen = new Set(
      picks.map((p) => p.chosenFactId).filter(Boolean),
    );
    stage = distinctChosen.size === 1 && picks.length === responses.length
      ? 'consensus'
      : 'diverged';
  }

  const addressees = (meta.addressees ?? []).map((a) => ({
    kind: a.kind === 'gmail' ? 'gmail' : 'slack',
    id: a.id,
  })) as { kind: 'slack' | 'gmail'; id: string }[];

  let escalationInfo: DecisionThreadState['escalation'];
  if (escalation) {
    const m = parseNotes(escalation.notes ?? '');
    if (m?.role && m?.to) {
      escalationInfo = {
        role: m.role as EscalationRole,
        authorityEmail: m.to,
      };
    }
  }

  let resolutionInfo: DecisionThreadState['resolution'];
  if (resolution) {
    const m = parseNotes(resolution.notes ?? '');
    if (m?.winner) {
      resolutionInfo = {
        winnerFactId: m.winner,
        winnerValue: resolution.metricValue,
        via: m.via ?? 'unknown',
      };
    }
  }

  return {
    threadId,
    askFactId: ask.id,
    stage,
    addressees,
    responses,
    escalation: escalationInfo,
    resolution: resolutionInfo,
  };
}

export async function loadOpenAuthorAsks(
  userId: string,
  workspace: string = 'inazuma',
): Promise<AuthorAsk[]> {
  const asks = await prisma.factEvent.findMany({
    where: {
      userId,
      workspace,
      sourceRef: { startsWith: 'decide:ask:' },
      status: 'active',
    },
    select: {
      id: true,
      sourceRef: true,
      notes: true,
      signedAt: true,
    },
    orderBy: { signedAt: 'desc' },
  });

  const out: AuthorAsk[] = [];
  for (const ask of asks) {
    const meta = parseNotes(ask.notes ?? '');
    if (!meta?.threadId || !meta.entity || !meta.metricKey) continue;
    // Filter out synthetic asks from escalateDirectly. Those are anchors
    // for the chain when there are no human authors to ping — they should
    // never appear in a "Questions for source-authors" panel because
    // there are no humans to answer. Detected via the explicit
    // `skipped=no_human_authors` marker we write in escalateDirectly.
    if ((ask.notes ?? '').includes('skipped=no_human_authors')) continue;
    // Filter out asks already resolved.
    const resolved = await prisma.factEvent.findFirst({
      where: { userId, workspace, sourceRef: `decide:resolution:${meta.threadId}` },
      select: { id: true },
    });
    if (resolved) continue;
    // Filter out asks already fully responded to (every addressee has answered).
    const responses = await prisma.factEvent.findMany({
      where: { userId, workspace, sourceRef: `decide:response:${meta.threadId}` },
      select: { id: true },
    });
    if (responses.length >= (meta.addressees?.length ?? 0)) continue;

    const candidates = await prisma.factEvent.findMany({
      where: { id: { in: meta.conflictFactIds ?? [] } },
      select: { id: true, metricValue: true, sourceRef: true },
    });

    // Demo flow: any signed-in user can respond "as" any pending addressee.
    // Render one row per addressee. Pick the first as "my matched" for type.
    const firstAddressee = (meta.addressees ?? [])[0];
    if (!firstAddressee) continue;

    out.push({
      threadId: meta.threadId,
      askFactId: ask.id,
      entity: meta.entity,
      metricKey: meta.metricKey,
      candidateFactIds: meta.conflictFactIds ?? [],
      candidates: candidates.map((c) => ({
        factId: c.id,
        value: c.metricValue,
        sourceKind: c.sourceRef.split(':')[0],
      })),
      addressees: (meta.addressees ?? []).map((a) =>
        a.kind === 'gmail'
          ? { kind: 'gmail' as const, id: a.id }
          : { kind: 'slack' as const, id: a.id },
      ),
      myMatchedAddressee: firstAddressee.kind === 'gmail'
        ? { kind: 'gmail', id: firstAddressee.id }
        : { kind: 'slack', id: firstAddressee.id },
    });
  }
  return out;
}

export interface ThreadLineageRow {
  factId: string;
  sourceRef: string;
  claim: string;
  signedAt: Date;
  parentHash: string | null;
  eventHash: string;
  signerPubkey: string;
  status: string;
  notes: string | null;
}

export async function loadDecisionThread(
  userId: string,
  threadId: string,
  workspace: string = 'inazuma',
): Promise<ThreadLineageRow[]> {
  const events = await prisma.factEvent.findMany({
    where: {
      userId,
      workspace,
      OR: [
        { sourceRef: `decide:ask:${threadId}` },
        { sourceRef: `decide:response:${threadId}` },
        { sourceRef: `decide:escalation:${threadId}` },
        { sourceRef: `decide:resolution:${threadId}` },
      ],
    },
    select: {
      id: true,
      sourceRef: true,
      claim: true,
      signedAt: true,
      parentHash: true,
      eventHash: true,
      signerPubkey: true,
      status: true,
      notes: true,
    },
    orderBy: { signedAt: 'asc' },
  });
  return events.map((e) => ({
    factId: e.id,
    sourceRef: e.sourceRef,
    claim: e.claim,
    signedAt: e.signedAt,
    parentHash: e.parentHash,
    eventHash: e.eventHash,
    signerPubkey: e.signerPubkey,
    status: e.status,
    notes: e.notes,
  }));
}

interface NotesShape {
  threadId?: string;
  entity?: string;
  metricKey?: string;
  conflictFactIds?: string[];
  addressees?: { kind: string; id: string }[];
  by?: string;
  choice?: string;
  chosenFact?: string;
  role?: string;
  to?: string;
  via?: string;
  winner?: string;
  losers?: string;
}

function parseNotes(notes: string): NotesShape | null {
  if (!notes) return null;
  const get = (key: string): string | undefined => {
    const m = notes.match(new RegExp(`(?:^|:)${key}=([^:]+)`));
    return m?.[1];
  };
  const threadId = get('decide:thread') ?? notes.match(/decide:thread=([A-Za-z0-9]+)/)?.[1];
  const conflictFacts = get('conflictFacts');
  // addressees is always the LAST field in notes; `.*` tolerates the
  // empty list emitted by escalateDirectly's synthetic ask.
  const addresseesRaw = notes.match(/(?:^|:)addressees=(.*)$/)?.[1];
  return {
    threadId,
    entity: get('entity'),
    metricKey: get('metricKey'),
    conflictFactIds: conflictFacts ? conflictFacts.split(',').filter(Boolean) : undefined,
    addressees: addresseesRaw
      ? addresseesRaw
          .split(',')
          .map((s) => {
            const [kind, ...rest] = s.split(':');
            const id = rest.join(':');
            return kind && id ? { kind, id } : null;
          })
          .filter((x): x is { kind: string; id: string } => x !== null)
      : undefined,
    by: get('by'),
    choice: get('choice'),
    chosenFact: get('chosenFact'),
    role: get('role'),
    to: get('to'),
    via: get('via'),
    winner: get('winner'),
    losers: get('losers'),
  };
}
