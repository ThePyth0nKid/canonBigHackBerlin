/**
 * Pure-JS signer — drops the Rust canon-signer subprocess on production
 * (Railway has no /Users/nelsonmehlis/.../canon-signer binary). Output is
 * bit-identical to the Rust signer for the payload + envelope encoding
 * contract documented in canon-signer/src/event.rs:
 *
 *   payload = CBOR array(7) of:
 *     [0] parent_hash : bstr   (hex-decoded; bstr<0> for genesis)
 *     [1] fact_id     : tstr
 *     [2] entity      : tstr
 *     [3] claim       : tstr
 *     [4] source_ref  : tstr
 *     [5] source_excerpt : tstr | null (0xf6)
 *     [6] created_at_ms  : uint
 *
 *   event_hash = sha256(payload) hex lowercase
 *   envelope   = COSE_Sign1 = [protected_bstr, {}, payload, signature]
 *                under aad b"canon/fact/v1", alg = -8 (EdDSA)
 *
 * Key handling: ephemeral per-process by default; pin a stable signer
 * across restarts by setting `CANON_SIGNER_KEY_HEX` (32 raw bytes, 64
 * hex chars). Each fact carries its own pubkey so kid rotation is fine
 * — the hash chain is anchored on parent_hash bytes, not key identity.
 */

import { signAsync, getPublicKeyAsync } from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';

import type { SignRequest, SignResponse } from './sign';

const COSE_EXTERNAL_AAD = new TextEncoder().encode('canon/fact/v1');
const CANON_KID_PREFIX = 'canon/';
const COSE_ALG_EDDSA = -8;

interface KeyPair {
  seed: Uint8Array;       // 32-byte Ed25519 seed
  pubkey: Uint8Array;     // 32-byte raw pubkey
  kid: string;            // canon/<first-16-hex-of-pubkey>
  pubkeyWire: string;     // ed25519:<base64(pubkey)>
}

let cachedKey: KeyPair | null = null;
let warnedAboutEphemeral = false;

async function loadOrGenerateKey(): Promise<KeyPair> {
  if (cachedKey) return cachedKey;

  const envHex = process.env.CANON_SIGNER_KEY_HEX;
  let seed: Uint8Array;
  if (envHex && /^[0-9a-fA-F]{64}$/.test(envHex)) {
    seed = hexToBytes(envHex);
  } else {
    seed = new Uint8Array(randomBytes(32));
    if (!warnedAboutEphemeral) {
      console.warn(
        '[canon-signer] CANON_SIGNER_KEY_HEX not set — using ephemeral key for this process. ' +
          'Set the env var (32-byte hex) to keep the same kid across restarts.',
      );
      warnedAboutEphemeral = true;
    }
  }
  const pubkey = await getPublicKeyAsync(seed);
  const kid = CANON_KID_PREFIX + bytesToHex(pubkey).slice(0, 16);
  const pubkeyWire = 'ed25519:' + Buffer.from(pubkey).toString('base64');
  cachedKey = { seed, pubkey, kid, pubkeyWire };
  return cachedKey;
}

/** Sign a single fact, producing the same response shape as the Rust signer. */
export async function signFact(req: SignRequest): Promise<SignResponse> {
  const key = await loadOrGenerateKey();

  const payload = encodePayload(req);
  const eventHash = bytesToHex(sha256(payload));

  const protectedBstr = encodeProtectedHeader(key.kid);
  const tbs = encodeSigStructure1(protectedBstr, COSE_EXTERNAL_AAD, payload);
  const signature = await signAsync(tbs, key.seed);

  const envelope = encodeCoseSign1Envelope(protectedBstr, payload, signature);

  return {
    factId: req.factId,
    eventHash,
    coseSign1Hex: bytesToHex(envelope),
    signerPubkey: key.pubkeyWire,
    signedAtMs: Date.now(),
  };
}

/* -------------------------------------------------------------------------- *
 * CBOR encoders — minimal canonical encoding for the fixed shapes Canon uses.
 * Definite-length arrays/maps/strings, smallest-int width.
 * -------------------------------------------------------------------------- */

function encodePayload(req: SignRequest): Uint8Array {
  const parentBytes = req.parentHash ? hexToBytes(req.parentHash) : new Uint8Array(0);
  const factIdBytes = utf8(req.factId);
  const entityBytes = utf8(req.entity);
  const claimBytes = utf8(req.claim);
  const refBytes = utf8(req.sourceRef);
  const excerpt: Uint8Array | null =
    req.sourceExcerpt !== null && req.sourceExcerpt !== undefined
      ? utf8(req.sourceExcerpt)
      : null;

  return concatBytes(
    new Uint8Array([0x87]), // array(7)
    cborBytesHeader(parentBytes.length),
    parentBytes,
    cborTextHeader(factIdBytes.length),
    factIdBytes,
    cborTextHeader(entityBytes.length),
    entityBytes,
    cborTextHeader(claimBytes.length),
    claimBytes,
    cborTextHeader(refBytes.length),
    refBytes,
    excerpt
      ? concatBytes(cborTextHeader(excerpt.length), excerpt)
      : new Uint8Array([0xf6]), // null
    cborUint(req.createdAtMs),
  );
}

function encodeProtectedHeader(kid: string): Uint8Array {
  // CBOR map(2): {1: -8, 4: bstr(kid)}
  // 0xa2 = major 5, len 2
  // key 1 = 0x01; value -8 = negative int = 0x20 | 7 = 0x27
  // key 4 = 0x04; value bstr(kid bytes)
  const kidBytes = utf8(kid);
  const inner = concatBytes(
    new Uint8Array([0xa2, 0x01, 0x27, 0x04]),
    cborBytesHeader(kidBytes.length),
    kidBytes,
  );
  // The protected header is the BYTES of the inner map — those bytes are then
  // wrapped as a single bstr in the outer envelope.
  return inner;
}

function encodeCoseSign1Envelope(
  protectedBstr: Uint8Array,
  payload: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  // [protected_as_bstr, {}, payload_as_bstr, sig_as_bstr]
  // unprotected = empty map = 0xa0
  return concatBytes(
    new Uint8Array([0x84]), // array(4)
    cborBytesHeader(protectedBstr.length),
    protectedBstr,
    new Uint8Array([0xa0]), // empty map
    cborBytesHeader(payload.length),
    payload,
    cborBytesHeader(signature.length),
    signature,
  );
}

function encodeSigStructure1(
  protectedBstr: Uint8Array,
  aad: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  const ctx = utf8('Signature1');
  return concatBytes(
    new Uint8Array([0x84]),
    cborTextHeader(ctx.length),
    ctx,
    cborBytesHeader(protectedBstr.length),
    protectedBstr,
    cborBytesHeader(aad.length),
    aad,
    cborBytesHeader(payload.length),
    payload,
  );
}

function cborTextHeader(len: number): Uint8Array {
  return cborTypeHeader(0x60, len);
}
function cborBytesHeader(len: number): Uint8Array {
  return cborTypeHeader(0x40, len);
}
function cborTypeHeader(majorBase: number, len: number): Uint8Array {
  if (len < 24) return new Uint8Array([majorBase | len]);
  if (len < 0x100) return new Uint8Array([majorBase | 24, len]);
  if (len < 0x10000) {
    return new Uint8Array([majorBase | 25, (len >>> 8) & 0xff, len & 0xff]);
  }
  if (len < 0x100000000) {
    return new Uint8Array([
      majorBase | 26,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
    ]);
  }
  throw new Error(`length ${len} exceeds CBOR uint32 cap`);
}

/** CBOR major type 0 (uint) with smallest width — supports up to u64. */
function cborUint(n: number): Uint8Array {
  if (n < 0 || !Number.isFinite(n)) throw new Error(`cbor uint: invalid ${n}`);
  if (n < 24) return new Uint8Array([n]);
  if (n < 0x100) return new Uint8Array([0x18, n]);
  if (n < 0x10000) return new Uint8Array([0x19, (n >>> 8) & 0xff, n & 0xff]);
  if (n < 0x100000000) {
    return new Uint8Array([
      0x1a,
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ]);
  }
  // u64 path: split into hi/lo 32-bit halves via BigInt to avoid >>> 32 = 0 quirk.
  const big = BigInt(n);
  const mask = BigInt('0xffffffff');
  const hi = Number((big >> BigInt(32)) & mask);
  const lo = Number(big & mask);
  return new Uint8Array([
    0x1b,
    (hi >>> 24) & 0xff,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  ]);
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('odd-length hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
