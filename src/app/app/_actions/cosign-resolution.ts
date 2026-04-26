'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { CanonSigner } from '@/lib/canon/sign';
import { requireAdmin } from '@/lib/canon/admin';
import { readCosignContext, clearCosignCookie } from '@/lib/canon/cosign-cookie';
import { isAdminEmail } from '@/lib/canon/admin';

/**
 * Second-admin co-sign for a high-risk resolution-pending row.
 *
 * The original initiator wrote a signed 'resolution-pending' event and
 * left the loser facts 'active'. A different admin reads the proposal
 * and either co-signs (status flips to 'resolution', losers flip to
 * 'superseded' atomically with a new co-sign event on the chain) or
 * just leaves it pending forever (the proposal stays as an audit-
 * trail-only record of what someone wanted to do).
 *
 * Hard rule: cosigner email must differ from initiator email. The
 * initiator email lives in the original row's notes
 * (`pending:awaiting-cosign:tier=high:initiator=<email>:winner=...:losers=...`).
 *
 * Trust-gate: this file is allowlisted in .semgrep/canon-trust-gate.yml
 * because it uses CanonSigner directly — the signer IS the trust
 * boundary, exactly like resolve.ts.
 */
export async function coSignResolution(args: {
  resolutionFactId: string;
}): Promise<
  | {
      ok: true;
      superseded: number;
      cosignEventHash: string;
      cosignerEmail: string;
    }
  | { ok: false; error: string }
> {
  // Authorise via either an OAuth admin session OR a magic-link cosign
  // cookie tied to this exact resolutionFactId. The cookie path is what
  // makes the email-roundtrip demo work without forcing the recipient
  // through Google sign-in.
  const admin = await requireAdmin();
  const cosignCtx = await readCosignContext();
  const ctxBoundToThis =
    cosignCtx && cosignCtx.resolutionFactId === args.resolutionFactId
      ? cosignCtx
      : null;
  let cosignerUserId: string | null = null;
  let cosignerEmail = '';
  if (admin.ok) {
    cosignerUserId = admin.userId;
    cosignerEmail = (admin.email || '').toLowerCase();
  } else if (ctxBoundToThis && isAdminEmail(ctxBoundToThis.asEmail)) {
    // Cookie-only path. Use the cookie's email as the cosigner identity.
    // userId stays null until we fetch the original row (we'll record
    // the cosign event under the initiator's userId since the magic-link
    // recipient has no UserRow of their own in the demo workspace).
    cosignerEmail = ctxBoundToThis.asEmail.toLowerCase();
  } else {
    return { ok: false, error: 'admin-required' };
  }

  // Pending row lookup is workspace-scoped (no userId filter) so a second
  // admin signed in with a different OAuth identity — or a magic-link
  // recipient with no session at all — can find the initiator's row.
  const original = await prisma.factEvent.findFirst({
    where: { id: args.resolutionFactId },
    select: {
      id: true,
      userId: true,
      workspace: true,
      entity: true,
      metricKey: true,
      metricValue: true,
      metricUnit: true,
      status: true,
      notes: true,
      eventHash: true,
    },
  });
  if (!original) return { ok: false, error: 'pending-not-found' };
  if (original.status !== 'resolution-pending') {
    return { ok: false, error: `not-pending:status=${original.status}` };
  }

  const parsed = parsePendingNotes(original.notes ?? '');
  if (!parsed) return { ok: false, error: 'unparseable-pending-notes' };

  // Hard 4-eyes rule. The cosigner cannot be the initiator. Email is
  // the discriminator because userId is per-OAuth-account; we compare
  // case-insensitively against the initiator email recorded in notes.
  const initiator = parsed.initiator.toLowerCase();
  if (cosignerEmail && initiator && cosignerEmail === initiator) {
    return { ok: false, error: 'same-as-initiator' };
  }

  // The cosign event is recorded under the cosigner's userId when they
  // have one, otherwise under the initiator's userId (cookie-only path).
  // In both cases the human identity is the cosignerEmail recorded in
  // the signed claim + notes, which is the demo-relevant audit anchor.
  if (cosignerUserId === null) cosignerUserId = original.userId;

  const tail = await prisma.factEvent.findFirst({
    where: { workspace: original.workspace },
    orderBy: { signedAt: 'desc' },
    select: { eventHash: true },
  });
  const parentHash = tail?.eventHash ?? '';

  const cosignFactId = `f_cos_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const claim = `Co-sign (4-eyes complete): ${original.entity}.${original.metricKey ?? '?'} = ${original.metricValue ?? '(no value)'} — ${cosignerEmail} co-signed proposal by ${parsed.initiator}; ${parsed.loserIds.length} fact${parsed.loserIds.length === 1 ? '' : 's'} now superseded.`;
  const sourceRef = `resolution:cosign:${cosignerEmail || cosignerUserId}`;

  const signer = new CanonSigner();
  signer.start();
  let signRes;
  try {
    signRes = await signer.sign({
      factId: cosignFactId,
      entity: original.entity,
      claim,
      sourceRef,
      sourceExcerpt: claim,
      parentHash,
      createdAtMs: Date.now(),
    });
  } finally {
    await signer.close();
  }

  // Atomic: write the cosign event + flip pending→resolution + supersede losers.
  // Loser updateMany filters by id + workspace + status — no userId filter,
  // because the loser facts may have been ingested under any userId in
  // this workspace; the id list is authoritative (parsed from the signed
  // pending notes).
  const r = await prisma.$transaction([
    prisma.factEvent.create({
      data: {
        id: cosignFactId,
        userId: cosignerUserId,
        workspace: original.workspace,
        entity: original.entity,
        claim,
        metricKey: original.metricKey ?? null,
        metricValue: original.metricValue ?? null,
        metricUnit: original.metricUnit ?? null,
        sourceRef,
        sourceExcerpt: claim,
        parentHash: parentHash || null,
        eventHash: signRes.eventHash,
        coseSign1Hex: signRes.coseSign1Hex,
        signerPubkey: signRes.signerPubkey,
        signedAt: new Date(signRes.signedAtMs),
        observedAt: new Date(),
        status: 'resolution-cosign',
        notes: `cosign-of:${original.eventHash}:by:${cosignerEmail || cosignerUserId}`,
      },
    }),
    prisma.factEvent.update({
      where: { id: original.id },
      data: {
        status: 'resolution',
        notes: `${original.notes ?? ''};cosigned-by:${signRes.eventHash}:by:${cosignerEmail || cosignerUserId}`,
      },
    }),
    prisma.factEvent.updateMany({
      where: {
        id: { in: parsed.loserIds },
        workspace: original.workspace,
        status: 'active',
      },
      data: {
        status: 'superseded',
        notes: `superseded:user-pick-cosigned:${signRes.eventHash}`,
      },
    }),
  ]);

  // Magic-link cookie was scoped to THIS resolutionFactId. After cosign
  // success it has served its purpose — clear it so the cosigner doesn't
  // stay in cosign-mode for the rest of their session.
  if (ctxBoundToThis) {
    await clearCosignCookie();
  }

  revalidatePath('/app');
  revalidatePath('/decide');
  return {
    ok: true,
    superseded: r[2].count,
    cosignEventHash: signRes.eventHash,
    cosignerEmail: cosignerEmail || cosignerUserId,
  };
}

interface ParsedPending {
  initiator: string;
  winnerId: string;
  loserIds: string[];
}

function parsePendingNotes(notes: string): ParsedPending | null {
  const initMatch = /initiator=([^:]+):/.exec(notes);
  const winnerMatch = /winner=([^:]+):losers=([^;]*)/.exec(notes);
  if (!initMatch || !winnerMatch) return null;
  const loserIds = winnerMatch[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    initiator: initMatch[1],
    winnerId: winnerMatch[1],
    loserIds,
  };
}
