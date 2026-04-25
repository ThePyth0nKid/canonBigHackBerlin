# Context — System overview

**Read this BEFORE editing any code.** This is ground-truth what's wired and load-bearing.

---

## What Canon is

A signed-fact ledger for AI agents. Source data → Pioneer span extraction → Gemini audit → local PII/secret scan → Ed25519 signer → Postgres FactEvent rows in a hash chain. MCP tools expose lookup/search/cite/diff to any agent. UI at /app shows the canonical facts grouped by entity, with conflict resolution as signed events on the same chain.

## Top-level architecture

```
Sources           Pipeline                  Persistence
──────────       ──────────────────       ──────────────
qontext-dataset → Pioneer (extract) →
slack-synthetic → Gemini (audit)     → Ed25519 signer → Postgres FactEvent
gmail-synthetic → local scan (PII)         (Rust IPC)        (workspace='inazuma')
pdf-board       → decide() (status)
file-upload                                  ↓
tavily-search                          MCP tools (lookup/search/cite/diff)
                                       /app UI (Suspense + SSE)
```

## Module map (current state, post-pivot)

### Trust pipeline core
- `src/lib/canon/types.ts` — `FactDraft`, `FactEvent`, `RedactionEvent`, `ResolutionEvent` interfaces
- `src/lib/canon/pioneer.ts` — Fastino GLiNER-2 client (`api.pioneer.ai/gliner-2`). Verbatim span extractor.
- `src/lib/canon/audit.ts` — Vertex AI Gemini 2.5-flash auditor. Returns `{confirmed, contradiction, confidence}`. Fail-closed.
- `src/lib/canon/scan.ts` — Local regex/heuristic scanner. PII/secrets → `{cleared:false, redactionReason}`.
- `src/lib/canon/sign.ts` — Spawns Rust canon-signer subprocess. NDJSON IPC. Hash-chained.
- `src/lib/canon/pipeline.ts` — Orchestrates audit → scan → decide → sign → persist. **The ONLY legitimate writer of FactEvent rows.**
- `src/lib/canon/conflicts.ts` — Workspace-scoped conflict detection + auto-resolution (corroboration-dominance + observedAt recency).

### Source adapters
- `src/lib/ingest/qontext.ts` — Reads Qontext dataset (clients/vendors/customers/employees/emails/conversations/posts/IT-tickets/policies). Emits typed FactDrafts via mappers + Pioneer chunks for free-form text.
- `src/lib/ingest/upload.ts` — File-upload router: shape-detection per file, routes to Qontext mappers when matched, generic JSON-record fallback otherwise.
- `src/lib/ingest/slack.ts` / `gmail.ts` / `pdf.ts` — Synthetic Slack/Gmail/PDF (Northwind board deck). Currently writes to `workspace='northwind'` — P0-03 retargets to `inazuma`.

### API routes
- `src/app/api/sync/route.ts` — Synthetic Slack/Gmail/PDF sync (button-triggered)
- `src/app/api/ingest-upload/route.ts` — Multipart file upload, SSE response, P0-01 bulk-load uses CLI script not this
- `src/app/api/verify/route.ts` — `POST` returns chain-replay verification result
- `src/app/api/auth/[...nextauth]` — NextAuth v5 with Google OAuth

### UI
- `src/app/app/page.tsx` — Main /app view. Suspense-streamed landscape, currently 3-tab switcher (P0-03 collapses to 1).
- `src/lib/canon/view.ts` — `loadFactLandscape()` + `WORKSPACES` constant. UI data-shaping.
- `src/app/app/_components/`:
  - `aikido-banner.tsx` — Live OAuth2 fetch from app.aikido.dev. Server component.
  - `file-drop-ingest.tsx` — Drag-drop UI + SSE consumer. ETA, throttled fact-tail.
  - `conflict-resolve.tsx` — Modal with canonical + distinct modes.
  - `proof-modal.tsx` — eventHash + COSE bytes display. P1-05 adds Gemini reasoning section.
  - `source-pill.tsx` — slack/gmail/pdf/qontext/upload/tavily badges.
  - `sync-button.tsx` — triggers /api/sync (Slack/Gmail/PDF synthetic).
  - `workspace-switcher.tsx` — DELETE in P0-03.

### MCP server
- `mcp/canon-mcp.ts` — 6 tools: `canon_workspaces`, `canon_lookup`, `canon_search`, `canon_cite`, `canon_diff`, `canon_external_lookup` (Tavily). Plus `canon_write` stub.
- Registered user-scope, runs via `node mcp/canon-mcp.ts`.

### External integrations (current truth)

| Vendor | Wired? | Changes outcomes? | File |
|---|---|---|---|
| **Pioneer/Fastino** | Yes — load-bearing | Yes (extracts entities/metrics from free-form chunks) | `pioneer.ts` |
| **Gemini 2.5-flash (Vertex)** | Yes — load-bearing | Yes (`decide()` flips status to `superseded` on contradiction) | `audit.ts` + `pipeline.ts:219-236` |
| **Tavily** | Yes — auxiliary | No (returned with `unsigned:true`, never gets signed) | `tavily.ts` + `mcp/canon-mcp.ts` |
| **Aikido** | Yes — cosmetic only | **No** (does not gate `decide()`) | `aikido.ts` + `aikido-banner.tsx` |

### Database
- `prisma/schema.prisma` — `FactEvent` table with `userId`, `workspace`, `entity`, `claim`, `metricKey/value/unit`, `sourceRef`, `parentHash`, `eventHash`, `coseSign1Hex`, `signerPubkey`, `status`, `notes`.
- `notes` field is text — current convention is `audit:<status>:<json>` after P1-05 lands. Pre-P1-05: `audit:reason-text` raw.
- `parentHash` chains within `userId × workspace`. Genesis = empty string.

## Key invariants

1. **All FactEvent writes go through `runPipeline()`** (P1-04 enforces statically via Semgrep)
2. **Per-workspace hash chain** — separate chains for separate workspaces, independent integrity
3. **Fail-closed scan** — if local scan refuses, claim signed as `<redacted>`. Original is dropped (D9).
4. **Fail-soft audit** — if Gemini unreachable, status stays `active` with `notes='audit:offline'` (P0-02).
5. **Idempotent sourceRef** — re-ingesting same source produces hash-stable drafts (deterministic).

## Prod state (as of Sat 22:30)

- Railway hosts canon-web service
- DB: ~3000 inazuma facts + ~89 northwind facts (P0-03 deletes the latter)
- DATABASE_URL in local .env points at Railway prod
- Latest deploy: 93e12cb (logging additions for ingest-upload diagnosis)

## Don't change without thinking twice

- `src/lib/canon/sign.ts` — Rust IPC. Working correctly. Hands-off unless absolutely needed.
- `prisma/schema.prisma` — Schema migrations are risky mid-night. Pack new fields into existing `notes` column.
- The Rust `canon-signer` and `canon-verify` binaries — built artifacts, don't rebuild without intent.
- MCP tool signatures — public API for any agent. Adding optional fields OK, removing/renaming NOT OK.

## Where to look first when debugging

| Problem | Look here |
|---|---|
| Facts not appearing in /app | DB query → loadFactLandscape → page.tsx render |
| Wrong fact status | pipeline.ts decide() → audit.ts verdict shape |
| Signer hung | sign.ts spawn + NDJSON exchange |
| Pioneer 4xx/5xx | pioneer.ts callPioneer + env PIONEER_API_KEY |
| Gemini errors | audit.ts + env GOOGLE_CLOUD_PROJECT/LOCATION |
| Aikido banner blank | aikido.ts getRepoBanner + env AIKIDO_* |
| Upload SSE dies | ingest-upload route + railway logs |

---

*Update this when adding a new module or changing an integration's role.*
