/**
 * POST /api/verify — independently verify a fact's COSE_Sign1 envelope.
 *
 * Implementation: pure-TS verifier (`verifyCanonEnvelope`) using
 * @noble/ed25519 + a hand-rolled canonical CBOR encoder for
 * Sig_structure_1. Sigstore-style cross-language verification: the
 * signer is Rust (canon-signer sidecar), the verifier here has never
 * seen its source. Mathematics agree → trust is reproducible.
 *
 * Returns `{ verified, event_hash, kid, latencyMs }` on success or
 * `{ verified: false, error, latencyMs }` on failure. Output shape is
 * identical to the legacy Rust canon-verify CLI for client compatibility.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { verifyCanonEnvelope } from '@/lib/canon/verify-js';

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    factId?: string;
  } | null;
  if (!body?.factId) {
    return NextResponse.json({ error: 'factId required' }, { status: 400 });
  }

  const fact = await prisma.factEvent.findFirst({
    where: { id: body.factId, userId },
    select: { coseSign1Hex: true, signerPubkey: true },
  });
  if (!fact) {
    return NextResponse.json({ error: 'fact not found' }, { status: 404 });
  }

  const t0 = Date.now();
  try {
    const result = await verifyCanonEnvelope(fact.coseSign1Hex, fact.signerPubkey);
    return NextResponse.json({ ...result, latencyMs: Date.now() - t0 });
  } catch (e) {
    console.error('[/api/verify] unexpected error', e);
    return NextResponse.json(
      { verified: false, error: 'verify unavailable', latencyMs: Date.now() - t0 },
      { status: 500 },
    );
  }
}
