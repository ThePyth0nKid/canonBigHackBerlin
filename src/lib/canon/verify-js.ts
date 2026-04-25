/**
 * Pure-JS COSE_Sign1 verifier — independent reimplementation of the Rust
 * canon-verify CLI. Sigstore-style cross-language verification: the signer
 * is Rust (canon-signer Ed25519 sidecar), the verifier here has never seen
 * its source. If both implementations agree on the same envelope, you have
 * stronger evidence than if one piece of code did both.
 *
 * Implements RFC 9052 §4.4 Sig_structure_1, with two Canon-specific facts
 * pinned out of canon-signer/src/lib.rs:
 *   - external AAD     : "canon/fact/v1"
 *   - kid derivation   : "canon/" + first 16 hex chars of raw pubkey
 *
 * Output shape matches the Rust canon-verify CLI verbatim so the API
 * route can swap implementations with no client-side change:
 *   { verified: true,  event_hash, kid }
 *   { verified: false, error }
 */

import { verifyAsync } from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { decode as cborDecode } from 'cbor-x';

const COSE_EXTERNAL_AAD = new TextEncoder().encode('canon/fact/v1');
const CANON_KID_PREFIX = 'canon/';
/** RFC 8152: integer label -8 in the protected `alg` header = EdDSA. */
const COSE_ALG_EDDSA = -8;

export interface VerifyOk {
  verified: true;
  event_hash: string;
  kid: string;
}

export interface VerifyErr {
  verified: false;
  error: string;
}

export type VerifyResult = VerifyOk | VerifyErr;

/**
 * Verify a Canon fact's COSE_Sign1 envelope.
 *
 * @param envelopeHex `cose_sign1_hex` from FactEvent (CBOR bytes, hex).
 * @param pubkeyWire  `signer_pubkey` in `ed25519:<base64>` format.
 * @param kidOverride optional explicit kid; defaults to derive_kid(pubkey).
 */
export async function verifyCanonEnvelope(
  envelopeHex: string,
  pubkeyWire: string,
  kidOverride?: string,
): Promise<VerifyResult> {
  let envelopeBytes: Uint8Array;
  try {
    envelopeBytes = hexToBytes(envelopeHex);
  } catch (e) {
    return { verified: false, error: `envelope hex decode failed: ${(e as Error).message}` };
  }

  let pubkey: Uint8Array;
  try {
    pubkey = parsePubkey(pubkeyWire);
  } catch (e) {
    return { verified: false, error: `pubkey parse failed: ${(e as Error).message}` };
  }

  const expectedKid = kidOverride ?? deriveKid(pubkey);

  // Parse the envelope as untagged COSE_Sign1: a CBOR 4-element array
  //   [ protected_bstr, unprotected_map, payload_bstr | nil, signature_bstr ]
  // The protected header MUST be a bstr containing canonical-CBOR-encoded
  // header parameters; we decode it again to extract `alg` and `kid`.
  let envelope: unknown;
  try {
    envelope = cborDecode(envelopeBytes);
  } catch (e) {
    return { verified: false, error: `cbor parse failed: ${(e as Error).message}` };
  }
  if (!Array.isArray(envelope) || envelope.length !== 4) {
    return { verified: false, error: 'malformed envelope: not a 4-element CBOR array' };
  }
  const [protectedBstr, , payload, signature] = envelope as [
    Uint8Array, Map<unknown, unknown>, Uint8Array | null, Uint8Array,
  ];
  if (!(protectedBstr instanceof Uint8Array)) {
    return { verified: false, error: 'malformed envelope: protected header is not a bstr' };
  }
  if (!(payload instanceof Uint8Array)) {
    return { verified: false, error: 'malformed envelope: missing payload (detached not supported)' };
  }
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    return { verified: false, error: `malformed envelope: bad signature length ${(signature as Uint8Array)?.length ?? 0}` };
  }

  // Decode protected header. cbor-x decodes integer-keyed CBOR maps to
  // plain JS objects with stringified-int keys: `{1: -8, 4: <kid bytes>}`
  // ends up as `{'1': -8, '4': Buffer}`. Map instance is also possible
  // depending on encoder; normalise to a lookup function.
  let protectedHeader: unknown;
  try {
    protectedHeader = cborDecode(protectedBstr);
  } catch (e) {
    return { verified: false, error: `protected header parse failed: ${(e as Error).message}` };
  }
  const headerGet = (label: number): unknown => {
    if (protectedHeader instanceof Map) {
      return protectedHeader.get(label) ?? protectedHeader.get(String(label));
    }
    if (protectedHeader && typeof protectedHeader === 'object') {
      return (protectedHeader as Record<string, unknown>)[String(label)];
    }
    return undefined;
  };
  const alg = headerGet(1); // COSE label 1 = alg
  if (alg !== COSE_ALG_EDDSA) {
    return { verified: false, error: `unsupported alg: ${String(alg)} (expected ${COSE_ALG_EDDSA} = EdDSA)` };
  }
  const kidBytes = headerGet(4); // COSE label 4 = kid
  const kidInHeader = kidBytes instanceof Uint8Array ? new TextDecoder().decode(kidBytes) : null;
  if (!kidInHeader) {
    return { verified: false, error: 'protected header missing or non-utf8 kid' };
  }
  if (kidInHeader !== expectedKid) {
    return { verified: false, error: `kid mismatch: header=${kidInHeader} expected=${expectedKid}` };
  }

  // Reconstruct Sig_structure_1 per RFC 9052 §4.4 and CBOR-encode it
  // canonically. Hand-rolled rather than via a CBOR library: the To-Be-
  // Signed byte string must be bit-identical to what the Rust coset crate
  // produced at sign time, and any encoder discrepancy (indefinite lengths,
  // map ordering, integer width choices) flips the signature. This 4-element
  // structure is small + fixed shape, so a tiny canonical encoder is safer
  // than trusting a general-purpose CBOR lib's defaults.
  const tbs = encodeSigStructure1(protectedBstr, COSE_EXTERNAL_AAD, payload);

  let ok = false;
  try {
    ok = await verifyAsync(signature, tbs, pubkey);
  } catch (e) {
    return { verified: false, error: `signature verification threw: ${(e as Error).message}` };
  }
  if (!ok) {
    return { verified: false, error: 'signature verification failed' };
  }

  const eventHash = bytesToHex(sha256(payload));
  return { verified: true, event_hash: eventHash, kid: expectedKid };
}

/** Derive the Canon kid: "canon/" + first 16 hex chars of the raw pubkey. */
export function deriveKid(pubkey: Uint8Array): string {
  if (pubkey.length !== 32) {
    throw new Error(`expected 32-byte pubkey, got ${pubkey.length}`);
  }
  return CANON_KID_PREFIX + bytesToHex(pubkey).slice(0, 16);
}

function parsePubkey(wire: string): Uint8Array {
  const b64 = wire.startsWith('ed25519:') ? wire.slice('ed25519:'.length) : null;
  if (!b64) throw new Error('expected ed25519:<base64> prefix');
  const raw = Uint8Array.from(Buffer.from(b64, 'base64'));
  if (raw.length !== 32) throw new Error(`expected 32 bytes, got ${raw.length}`);
  return raw;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('odd-length hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`bad hex at offset ${i * 2}`);
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Canonical CBOR encoding of:
 *   ["Signature1", protected (bstr), aad (bstr), payload (bstr)]
 *
 * Definite-length array (4 items), definite-length text/byte strings,
 * smallest-int length encodings — i.e. RFC 8949 §4.2.1 canonical form
 * for this fixed shape. Matches what `coset::CoseSign1::verify_signature`
 * builds in the Rust signer.
 */
function encodeSigStructure1(
  protectedBstr: Uint8Array,
  aad: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  const ctx = new TextEncoder().encode('Signature1');
  // Major type 4 (array) head with len 4 fits in one byte: 0x80 | 4 = 0x84.
  const arrayHead = new Uint8Array([0x84]);
  return concatBytes(
    arrayHead,
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

/** CBOR major type 3 (text string) length prefix, smallest-int form. */
function cborTextHeader(len: number): Uint8Array {
  return cborTypeHeader(0x60, len);
}

/** CBOR major type 2 (byte string) length prefix, smallest-int form. */
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
