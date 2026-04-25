/**
 * Vertex AI auth bootstrap for environments where we can't put a Service
 * Account JSON on disk (Railway prod) and the GCP project blocks
 * SA-key creation (per `iam.disableServiceAccountKeyCreation` on the
 * BBH-sponsored project).
 *
 * Strategy:
 *   - Locally, you authenticate via `gcloud auth application-default login`
 *     which drops a JSON at ~/.config/gcloud/application_default_credentials.json
 *     containing your OAuth client_id + client_secret + refresh_token.
 *   - For Railway we copy that JSON content into a single env var
 *     `GOOGLE_APPLICATION_CREDENTIALS_JSON`. On process boot we materialise
 *     it to a tempfile and set GOOGLE_APPLICATION_CREDENTIALS to that path.
 *     The Google Auth library then discovers it via the standard ADC chain.
 *
 * Refresh tokens don't expire in normal use, so this works for the
 * lifetime of the demo without rotation.
 *
 * Idempotent: safe to import from many modules; the file is written once
 * per process and subsequent calls are no-ops.
 */

import { writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ADC_TARGET = join(tmpdir(), 'canon-adc.json');
let bootstrapped = false;
let lastError: string | null = null;

/**
 * Materialise GOOGLE_APPLICATION_CREDENTIALS_JSON env-var into a tempfile
 * and point GOOGLE_APPLICATION_CREDENTIALS at it. Call this synchronously
 * before any Vertex AI client is constructed.
 *
 * Returns true if bootstrap ran successfully OR was already set up via
 * another path (e.g. local gcloud); false if it could not be configured
 * (callers can decide whether to surface a friendlier error).
 */
export function bootstrapVertexAuth(): boolean {
  if (bootstrapped) return true;

  // If GOOGLE_APPLICATION_CREDENTIALS already points at a real file
  // (e.g. local dev with gcloud-ADC discovered out-of-band) leave it alone.
  const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (existing && existsSync(existing)) {
    bootstrapped = true;
    return true;
  }

  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!json) {
    // No env-var set. On the dev box gcloud's default-discovery path will
    // still work via ~/.config/gcloud, so silently return success for now;
    // the actual Vertex call will surface an auth error if it really fails.
    bootstrapped = true;
    return true;
  }

  try {
    // Validate it parses as JSON before writing — catches accidental
    // truncation in the env var early.
    const parsed = JSON.parse(json) as { type?: string };
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON did not parse to an object');
    }
    writeFileSync(ADC_TARGET, json, { encoding: 'utf-8' });
    // Lock down — refresh-token + client_secret in here; never world-readable.
    chmodSync(ADC_TARGET, 0o600);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = ADC_TARGET;
    console.log(
      `[vertex-bootstrap] wrote ADC to ${ADC_TARGET} (type=${parsed.type ?? 'unknown'})`,
    );
    bootstrapped = true;
    return true;
  } catch (e) {
    lastError = (e as Error).message;
    console.error('[vertex-bootstrap] FAILED', lastError);
    return false;
  }
}

export function vertexAuthError(): string | null {
  return lastError;
}
