/**
 * POST /api/verify — independently verify a fact's COSE_Sign1 envelope.
 *
 * Spawns the canon-verify CLI (separate binary from canon-signer — proves
 * the signature can be checked by something OTHER than what produced it).
 * Returns `{ verified, eventHash, kid, latencyMs }` or an error.
 */

import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

const VERIFY_BINARY =
  process.env.CANON_VERIFY_PATH ??
  '/Users/nelsonmehlis/Desktop/empheral/reference/validator/target/release/canon-verify';

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
    const result = await runVerify(fact.coseSign1Hex, fact.signerPubkey);
    return NextResponse.json({ ...result, latencyMs: Date.now() - t0 });
  } catch (e) {
    // Sanitize: never leak filesystem paths or internal stack info to the
    // client. Full detail still goes to server logs for debugging.
    console.error('[/api/verify] error', e);
    return NextResponse.json(
      { verified: false, error: 'verify unavailable', latencyMs: Date.now() - t0 },
      { status: 500 },
    );
  }
}

interface VerifyResult {
  verified: boolean;
  eventHash?: string;
  kid?: string;
  error?: string;
}

function runVerify(envelopeHex: string, pubkey: string): Promise<VerifyResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(VERIFY_BINARY, [
      '--envelope-hex',
      envelopeHex,
      '--pubkey',
      pubkey,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 2) return reject(new Error(stderr || 'canon-verify usage error'));
      try {
        const data = JSON.parse(stdout.trim()) as VerifyResult;
        resolve(data);
      } catch {
        resolve({
          verified: false,
          error: stderr || 'canon-verify produced invalid JSON',
        });
      }
    });
  });
}
