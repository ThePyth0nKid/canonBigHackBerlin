# Context — Trust Pipeline

**Read this BEFORE editing audit / scan / sign / decide / pipeline code.**

---

## What the pipeline does

Takes pre-extracted `FactDraft[]` + a long-context bundle, produces signed `FactEvent` rows in DB. Each draft passes through:

1. **Audit** (Gemini) — runs in parallel batch, returns verdict per draft
2. **Scan** (local) — sequential, returns `{cleared, redactionReason}` per draft
3. **Decide** — combines audit + scan into `{status, notes}`
4. **Sign** (Rust IPC) — Ed25519 + COSE_Sign1, hash chained on per-workspace tail
5. **Persist** — Prisma write to FactEvent

## Layer numbering (post-pivot, honest)

| Layer | Tool | Role | Gate? |
|---|---|---|---|
| 1 | Pioneer (Fastino GLiNER-2) | Pre-pipeline: extracts entities/metrics from chunks → FactDrafts | No (drafts go in either way; if extraction empty, draft just doesn't get created) |
| 2 | Gemini 2.5-flash | Audit drafts vs source body | Yes — flips status to `superseded` on contradiction |
| 3 | Local scan | PII/secret detection | Yes — flips status to `redacted`, drops original |
| 4 | Ed25519 signer (Rust) | Cryptographic seal + chain extension | No (always signs whatever decide() decided) |

**Aikido is NOT a layer.** It scans Canon's own source code via SAST. It does not see drafts, does not run in pipeline, does not gate decide(). The pitch line "Aikido watches the signer" is honest — it watches the code that runs the signer.

## Files

- `src/lib/canon/pipeline.ts` — orchestration, `runPipeline()`, `decide()`. **Only legitimate writer of FactEvent rows.**
- `src/lib/canon/audit.ts` — Gemini call (Vertex AI SDK)
- `src/lib/canon/scan.ts` — local regex/heuristic
- `src/lib/canon/sign.ts` — Rust IPC, NDJSON
- `src/lib/canon/types.ts` — interfaces

## decide() function (src/lib/canon/pipeline.ts ~line 219)

This is the load-bearing decision point.

Current logic (pre-P0-02):
```ts
if (!scan.cleared) return { status: 'redacted', notes: `redaction:${reason}` };
if (!verdict.confirmed && verdict.contradiction) {
  return { status: 'superseded', notes: `audit:${contradiction}` };
}
return { status: 'active' };
```

Post-P0-02 (after audit-bug fix):
```ts
if (!scan.cleared) return { status: 'redacted', notes: `redaction:${reason}` };
if (verdict.contradiction === 'audit_unavailable') {
  return { status: 'active', notes: 'audit:offline' };  // fail-soft
}
if (skipAudit) return { status: 'active', notes: 'audit:skipped' };
if (!verdict.confirmed && verdict.contradiction) {
  return { status: 'superseded', notes: `audit:flagged:${json}` };
}
return { status: 'active', notes: `audit:confirmed:${json}` };
```

Post-P1-05 packs the verdict as JSON in `notes` so the UI can render confidence + quote.

## Audit (Gemini) flow

`auditBatch(drafts, context, contextLabel)`:
1. Build prompt with system instruction + (post-P0-02) source body in user-role part
2. Call `gemini-2.5-flash` via Vertex AI with `responseSchema` for structured JSON output
3. Each draft gets `{confirmed, confidence, contradiction, contradictionQuote?}`
4. Concurrency limit ~4
5. Per-draft try/catch fall-back to `{confirmed:false, contradiction:'audit_unavailable'}`

Env required:
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION` (e.g. `us-central1`)
- Vertex AI authentication via service account or `gcloud auth application-default login`

## Scan (local) flow

`scanDraft(claim, sourceExcerpt)`:
1. Run regex set against claim + excerpt: AWS access keys, OpenAI keys, JWT, IBAN, credit-card, phone+name combos, etc.
2. First match → `{cleared:false, redactionReason: 'secret:openai_api_key'}` (or similar)
3. No matches → `{cleared:true}`

The regex set is in `src/lib/canon/scan.ts`. Includes `aikido_secret` pattern (matches Aikido-leaked tokens) — note this is a Canon-side rule, not an Aikido API call.

## Sign flow

`CanonSigner` wraps the Rust `canon-signer` binary (Ed25519 + COSE_Sign1):
1. Spawn child process: `cargo run --bin canon-signer` (or compiled binary)
2. Send NDJSON over stdin: `{factId, claim, sourceRef, parentHash, ...}`
3. Read NDJSON over stdout: `{eventHash, coseSign1Hex, signerPubkey, signedAtMs}`
4. Sign loop reuses one process for the whole pipeline run

**Don't restart the signer per fact** — startup is ~200ms, would 100x the runtime.

## Hash chain integrity

```
Genesis: parentHash = ""
Event 1: parentHash = "", eventHash = sha256(serialize(event_1))
Event 2: parentHash = event_1.eventHash, eventHash = sha256(serialize(event_2))
...
```

Replay (canon-verify binary): walk events in `signedAt asc` order, for each:
1. Verify `parentHash` matches previous event's `eventHash`
2. Verify `coseSign1Hex` validates with `signerPubkey`
3. Verify `eventHash` matches sha256 of canonicalized event content

Tampered row anywhere = chain breaks at that point onward.

## Error policy

| Error | Behavior |
|---|---|
| Gemini timeout / 5xx / quota | `verdict={confirmed:false, contradiction:'audit_unavailable'}` → fail-soft (P0-02) → status=active |
| Pioneer 5xx | Caller (qontext.ts / upload.ts) catches, drops chunk drafts. Direct drafts unaffected. |
| Scan regex match | `status=redacted`, claim+excerpt → `<redacted>`. Original NEVER persisted. |
| Signer process death | `pipeline.ts` per-draft try/catch. Skip persistence, keep chain anchored on prev event. Caller marked `superseded` with `notes='sign_failed:...'`. |
| Postgres write failure | Throws up — pipeline aborts. Chain integrity preserved (last successful write is tail). |

## What MUST NOT change

- The `runPipeline` function signature (MCP, ingest-upload, sync route all call it)
- The `parentHash` semantics (chain integrity)
- The `signedAt asc` ordering for chain replay
- The `coseSign1Hex` field name (canon-verify reads it)
- The interaction between `decide()` and `notes` (parser tolerates both old and new formats)

## What CAN change safely

- Verdict JSON shape inside `notes` (parser handles unknowns)
- New `notes` prefixes (e.g. `audit:offline`)
- Pioneer batch size, threshold
- Scan regex additions

## Common bugs to avoid

- ❌ Throwing inside the sign loop without catching → corrupts chain (parent_hash anchored to skipped event)
- ❌ Not awaiting signer.close() → Rust process orphaned
- ❌ Calling prisma.factEvent.create outside runPipeline → bypasses signer (P1-04 catches this statically)
- ❌ Writing to one workspace's chain after reading another's tail → chain divergence
