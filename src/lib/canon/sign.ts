/**
 * canon-signer NDJSON-IPC client (Layer 4 of the Trust Pipeline).
 *
 * Spawns the Rust binary as a long-lived subprocess and streams sign-ops
 * over stdin/stdout. Protocol per bigHack/09-PRE-HACKATHON-GAMEPLAN.md §A.2:
 *   request:  {op:"sign", fact_id, entity, claim, source_ref, source_excerpt,
 *              parent_hash, created_at_ms}
 *   response: {fact_id, event_hash, cose_sign1_hex, signer_pubkey, signed_at_ms}
 *   error:    {error, detail}
 *
 * One process, streaming, ~ms-per-sign. Ephemeral key auto-persists to
 * /var/folders/.../canon-signer.key for the lifetime of the host.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

export const DEFAULT_SIGNER_PATH =
  process.env.CANON_SIGNER_PATH ??
  '/Users/nelsonmehlis/Desktop/empheral/reference/validator/target/release/canon-signer';

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

interface PendingResolver {
  resolve: (r: SignResponse) => void;
  reject: (e: Error) => void;
}

interface RawSignResponse {
  fact_id?: string;
  event_hash?: string;
  cose_sign1_hex?: string;
  signer_pubkey?: string;
  signed_at_ms?: number;
  error?: string;
  detail?: string;
}

/**
 * Long-lived signer subprocess. Spawn once, sign N times, close at end.
 * Multiple in-flight requests are matched back to their callers by fact_id.
 */
export class CanonSigner {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private pending = new Map<string, PendingResolver>();
  private startupBanner: string | null = null;

  constructor(private readonly binaryPath: string = DEFAULT_SIGNER_PATH) {}

  start(): void {
    if (this.child) return;
    this.child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('error', (err) => this.failAll(err));
    this.child.on('exit', (code, sig) => {
      if (this.pending.size > 0) {
        this.failAll(
          new SignerError(`signer exited unexpectedly (code=${code}, signal=${sig})`),
        );
      }
    });
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      // The first stderr line carries the pubkey; useful for debugging.
      if (!this.startupBanner) this.startupBanner = text.trim();
    });
    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => this.onLine(line));
  }

  async sign(req: SignRequest): Promise<SignResponse> {
    if (!this.child) this.start();
    if (!this.child || !this.child.stdin.writable) {
      throw new SignerError('signer subprocess not writable');
    }

    const payload = {
      op: 'sign',
      fact_id: req.factId,
      entity: req.entity,
      claim: req.claim,
      source_ref: req.sourceRef,
      source_excerpt: req.sourceExcerpt,
      parent_hash: req.parentHash,
      created_at_ms: req.createdAtMs,
    };

    return new Promise<SignResponse>((resolve, reject) => {
      this.pending.set(req.factId, { resolve, reject });
      this.child!.stdin.write(JSON.stringify(payload) + '\n', (err) => {
        if (err) {
          this.pending.delete(req.factId);
          reject(new SignerError('failed to write to signer stdin', err.message));
        }
      });
    });
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: RawSignResponse;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON stdout (e.g. boot info) — ignore.
      return;
    }

    if (parsed.error) {
      // Errors don't carry fact_id; fail the oldest pending request.
      const oldestKey = this.pending.keys().next().value;
      if (oldestKey) {
        const r = this.pending.get(oldestKey)!;
        this.pending.delete(oldestKey);
        r.reject(new SignerError(parsed.error, parsed.detail));
      }
      return;
    }

    const id = parsed.fact_id;
    if (!id) return;
    const resolver = this.pending.get(id);
    if (!resolver) return;
    this.pending.delete(id);

    if (
      !parsed.event_hash ||
      !parsed.cose_sign1_hex ||
      !parsed.signer_pubkey ||
      typeof parsed.signed_at_ms !== 'number'
    ) {
      resolver.reject(new SignerError('signer response missing fields'));
      return;
    }

    resolver.resolve({
      factId: id,
      eventHash: parsed.event_hash,
      coseSign1Hex: parsed.cose_sign1_hex,
      signerPubkey: parsed.signer_pubkey,
      signedAtMs: parsed.signed_at_ms,
    });
  }

  private failAll(err: Error): void {
    for (const [, r] of this.pending) r.reject(err);
    this.pending.clear();
  }

  async close(): Promise<void> {
    if (!this.child) return;
    return new Promise((resolve) => {
      this.child!.once('exit', () => resolve());
      this.child!.stdin.end();
    });
  }
}
