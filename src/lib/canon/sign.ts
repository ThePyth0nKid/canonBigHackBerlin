/**
 * canon-signer adapter (Layer 4 of the Trust Pipeline).
 *
 * Historical: spawned a Rust subprocess at DEFAULT_SIGNER_PATH and
 * streamed sign-ops over NDJSON. That binary doesn't exist on Railway
 * prod, so the spawn hung and every signing UI action ("Sign as
 * canonical", sync, ingest-upload) stalled with no error.
 *
 * Current: thin wrapper around `signFact()` in sign-js.ts — a pure-TS
 * implementation that produces bit-identical Ed25519 + COSE_Sign1
 * envelopes. Same interface (`start`/`sign`/`close`) so every caller
 * (resolve.ts server actions, /api/sync, /api/ingest-upload, scripts)
 * works unchanged. start/close are no-ops; sign is in-process.
 *
 * Key handling: per-process ephemeral by default (each Railway cold
 * start gets a new kid; old facts still verify against their own stored
 * pubkey, hash chain still anchors on parent_hash bytes). Set
 * `CANON_SIGNER_KEY_HEX` (32-byte hex) to pin a stable kid across
 * deploys.
 */

import { signFact } from './sign-js';

/** Legacy env knob — retained so deploy configs that still set it don't break.
 *  No longer dispatches to a binary; pure-TS path is the only path. */
export const DEFAULT_SIGNER_PATH = process.env.CANON_SIGNER_PATH ?? '(pure-js, no binary)';

export interface SignRequest {
  factId: string;
  entity: string;
  claim: string;
  sourceRef: string;
  sourceExcerpt: string;
  parentHash: string;
  createdAtMs: number;
}

export interface SignResponse {
  factId: string;
  eventHash: string;
  coseSign1Hex: string;
  signerPubkey: string;
  signedAtMs: number;
}

export class SignerError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'SignerError';
  }
}

/**
 * Stateless wrapper kept for interface stability with the old subprocess
 * version. `start()` / `close()` are no-ops; `sign()` calls the pure-TS
 * signer directly.
 */
export class CanonSigner {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly _binaryPath: string = DEFAULT_SIGNER_PATH) {}

  start(): void {
    // No-op — there is no subprocess to start. Retained for interface parity.
  }

  async sign(req: SignRequest): Promise<SignResponse> {
    try {
      return await signFact(req);
    } catch (e) {
      throw new SignerError('sign failed', (e as Error).message);
    }
  }

  async close(): Promise<void> {
    // No-op.
  }
}
