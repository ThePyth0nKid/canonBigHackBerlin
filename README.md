# Canon

**One file. Every source. Every agent.**

[![MIT License](https://img.shields.io/badge/license-MIT-slategray)](./LICENSE)
[![Live](https://img.shields.io/badge/live-canon.ultranova.io-10b981)](https://canon.ultranova.io)
[![Big Berlin Hack 2026](https://img.shields.io/badge/Big_Berlin_Hack-2026-7c3aed)](https://www.bigberlinhack.com)
[![Track: Qontext](https://img.shields.io/badge/Track-Qontext-f59e0b)](https://qontext.com)
[![MCP](https://img.shields.io/badge/MCP-9_tools-2563eb)](#mcp-integration)
[![Trust-gate](https://img.shields.io/badge/Trust_gate-Opengrep-ea580c)](./.semgrep/canon-trust-gate.yml)

A cryptographically signed, hash-chained **context layer for AI agents**. Every fact is extracted from a real source (Slack, Gmail, PDF, Qontext-dataset), audited by Gemini, scanned by Aikido, signed with Ed25519, and chained into an audit trail your agents can verify offline — over the Model Context Protocol.

It came out of a 36-hour solo build at **Big Berlin Hack 2026**. I was on the **Qontext** track — the host sponsor whose thesis is that *context is the next layer of the AI stack*. About four hours in I realized the interesting problem in 2026 isn't agents asking the wrong questions; it's that they can't tell what's actually true. Every AI agent in your company today reconstructs your company from scratch — every prompt, every call. They search your emails, guess from old tickets, hallucinate what's in the CRM. That's not a prompt problem; it's an **infrastructure problem**.

**Canon is the open-source reference implementation of Qontext's thesis** — built to validate where Canon makes sense to stop and where Qontext makes sense to start. MIT-licensed from day one, every fact is provable, every signature is independently verifiable, every conflict is human-resolved on a chain that reads forwards and backwards.

> *"Every system writes. Every agent reads. One file. No guessing."*

- Try it: **[canon.ultranova.io](https://canon.ultranova.io)** (sign in with Google, click Sync)
- 4-eyes demo runbook (record-friendly): [`docs/4-eyes-demo-runbook.md`](./docs/4-eyes-demo-runbook.md)
- Security audit + hardening log: [`docs/4-eyes-audit.md`](./docs/4-eyes-audit.md)
- Pick-safety architecture deep-dive: [`docs/4-eyes-full-implementation.md`](./docs/4-eyes-full-implementation.md)

---

## The four surfaces

Canon's hash chain is written from — and read by — four different surfaces. Every event in the same Ed25519 chain, bit-identical to a verifier, regardless of which surface produced it.

| Surface | URL / entry | What it's for |
|---|---|---|
| 🌐 **Landing** | [`canon.ultranova.io`](https://canon.ultranova.io) | Pitch, pricing, the Qontext-track badge, sign-in. The public face of Canon — first thing a judge or design-partner sees. |
| 🧠 **AskCanon `/app`** | [`canon.ultranova.io/app`](https://canon.ultranova.io/app) | Free-form Q&A backed by Gemini over the signed ledger; inline conflict resolution with 4-eyes badges; live tracking panel for pending high-risk picks awaiting co-sign. |
| ✉️ **Decide `/decide`** | [`canon.ultranova.io/decide`](https://canon.ultranova.io/decide) | Customer-facing decision inbox. Source-authors get magic-link emails when their facts conflict; the deal-owner gets an escalation if they diverge. Every step a signed FactEvent. |
| 🤖 **Terminal & MCP** | `claude mcp add canon …` | Nine MCP tools (`canon_lookup`, `canon_search`, `canon_resolve`, …) for any MCP-compatible agent (Claude Code, Cursor, Windsurf, Zed). Two project-local skills (`/canon-write`, `/canon-resolve`) wrap them in a click-pick UX with `AskUserQuestion`. |

**The Web UIs give audit visibility. The MCP gives capabilities. The skills give workflow.** All four write bit-identical events into the same hash chain.

---

## The signed pipeline

Every fact lands on the chain only after passing a four-layer trust boundary:

```
Slack / Gmail / PDF / Qontext-dataset
       │
       ▼
┌──────────────────────────────────────┐
│ 1. Pioneer (Fastino GLiNER-2)        │  deterministic span extraction
│    → FactDraft[]                     │
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 2. Gemini 2.5-flash (Vertex AI)      │  long-context audit (~120k tokens)
│    → confirm / contradict            │  fail-CLOSED on error
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 3. Aikido / Opengrep                 │  PII + secret refusal
│    → RedactionEvent (recursive)      │  trust-gate enforces signed writes
└──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ 4. canon-signer (Ed25519 + COSE_Sign1)│  hash-chained per workspace
│    → FactEvent on the chain          │
└──────────────────────────────────────┘
```

Tavily-sourced web context lives **next to** the signed facts with an explicit `unsigned: true` marker — agents (and auditors) see exactly which is which.

---

## Pick safety: 4-Augen-Prinzip for AI-driven truth-making

Truth-making clicks are permanent on the chain. Canon ships three layers of defence, escalating with risk:

| Layer | Trigger | What happens |
|---|---|---|
| **L1 — Two-step confirm** | Every "Sign as canonical" / "Sign as distinct" click | Button morphs into a 1.5s-cooldown confirm strip with the consequence spelled out (*"N facts will flip to superseded; admin reverse required to undo"*) |
| **L2 — Admin reverse** | Wrong pick recognised after the fact | A new `ReverseResolutionEvent` is signed at the chain tip; previously-superseded facts flip back to `active`; original tagged `resolution-reversed` with a notes pointer to the reverse. **Nothing is ever deleted** — the audit chain reads forwards and backwards. |
| **L3 — 4-Augen co-sign** | Any high-risk metric (`arr`, `mrr`, `contract_value`, `revenue`, `renewal`, `churn`, `deal_size`, …) | Pick is signed as `resolution-pending`; supersedure is **skipped**; an email with a magic-link goes to every other admin in `CANON_ADMIN_EMAILS`. The link sets a cookie scoped to that exact `resolutionFactId`; a click on "Co-sign" by a **different** admin atomically flips status → resolution + supersedes losers + signs a co-sign event. Hard rule server-side: cosigner email ≠ initiator email. |

The pending event is signed and on the chain **before** any email goes out. Even an un-cosigned proposal leaves a permanent audit trace: *"X proposed Y at T, no second admin agreed."*

A live tracking panel above AskCanon lists every pending row workspace-wide; admins arriving via magic-link see their target row highlighted with a violet ring and a working **Co-sign · admin** button.

Hardening commit `3a06de7` applied 6 fixes from a parallel security + correctness audit. See [`docs/4-eyes-audit.md`](./docs/4-eyes-audit.md) for the full audit log.

---

## Decision inbox (`/decide`)

Customer-facing decision flow on the same signed ledger. When source-authors disagree on a fact (Slack message says X, CRM says Y), Canon emails the actual people whose messages produced each value, asks them to confirm, and escalates to the deal owner if they diverge — every step a signed FactEvent, every email a `MAGIC_LINK_SECRET`-signed token, every cookie scoped to one thread.

Four-stage tracker on each card: **Auto-resolve → Asked authors → Decision → Signed canon**. Persona-mode (RBAC-restricted view) hides admin actions from magic-link recipients server-side; admin-mode unlocks the full ask/escalate/decide cycle.

Same `MAGIC_LINK_SECRET`. Same Resend pipeline. Same hash chain. **One architecture, two compliance use-cases** (customer-decisions and 4-eyes co-sign).

---

## Quick start

```bash
git clone https://github.com/ThePyth0nKid/canonBigHackBerlin
cd canonBigHackBerlin
npm install
cp .env.example .env.local           # fill in DATABASE_URL, OAuth, API keys
npx prisma db push
npm run dev                          # localhost:3000
```

Open `localhost:3000` for the landing page, sign in, click **Sync now** on `/app` to ingest the seeded Slack + Gmail + PDF demo.

For the Qontext-supplied **Inazuma** dataset (the post-pivot primary):

```bash
npx tsx scripts/ingest-qontext.ts --no-audit --reset
open "http://localhost:3000/app"
```

---

## Workspaces

| Workspace | Purpose | Status |
|---|---|---|
| **`inazuma`** | Qontext-supplied enterprise dataset (400 clients, 400 vendors, 1260 employees, 11.9k emails, 2.9k conversations, 10.8k internal Q&A). 6 industry conflicts surface from the dataset's own duplicates plus 40 PII redactions caught by Layer 3. | **Live · primary post-pivot.** ~8800 active facts. Default workspace for the MCP server. |
| **`northwind`** | Seeded Slack `#sales`, Gmail `[canon-demo]`, board-deck PDF; ACME 50-vs-40 seats live conflict (Petra-locks-50 vs Greg-says-40). | Legacy demo, kept around for ACME-conflict story. |

Each workspace has its own hash chain. The MCP server defaults to `inazuma` and routes to whichever user owns the most active facts in that workspace (resilient against fresh test-user logins).

---

## MCP integration

Canon's MCP server exposes **9 tools** to any MCP-compatible agent:

| Tool                     | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `canon_workspaces`       | List workspaces with active fact counts                  |
| `canon_lookup`           | Signed facts about an entity (workspace-scoped)          |
| `canon_search`           | Free-text substring search (workspace-scoped)            |
| `canon_cite`             | Full COSE_Sign1 audit-chain proof for one factId         |
| `canon_diff`             | What changed for an entity since an ISO date             |
| `canon_external_lookup`  | UNSIGNED Tavily web context, side-by-side with signed    |
| `canon_write`            | Sign a new FactEvent through the shared scan→sign pipeline (`manual:agent-claude:<ISO>` source ref) |
| `canon_conflicts`        | List open `(entity, metric)` conflicts as a numbered `[1] [2] [3]` picker with `a/b/c` value letters |
| `canon_resolve`          | Sign a ResolutionEvent at the chain tip (`canonical` pick or `distinct` records) |

Wire it up:

```bash
claude mcp add --scope user canon -- npx tsx /absolute/path/canon/mcp/canon-mcp.ts
```

Or copy `mcp/claude-desktop-config.example.json` into `~/Library/Application Support/Claude/claude_desktop_config.json`.

### Terminal-native skills (Claude Code)

Two project-local skills under `.claude/skills/` wrap the write/conflicts/resolve tools in a click-pick UX using Claude Code's `AskUserQuestion` (no text-syntax to memorise — actual UI buttons in the terminal):

- **`/canon-write`** — capture entity / claim / source in chat, render a preview block, then a single 3-button question (Sign / Edit / Cancel). On confirm, pipes through the shared sign-pipeline and quotes back the signed `factId` + `eventHash` + `parentHash`.
- **`/canon-resolve [entity?]`** — call `canon_conflicts`, render a one-line overview, then `AskUserQuestion` with up to 4 questions (one per conflict group), each offering the top 2 candidate values plus *"Mark as distinct records"* and *"Skip for now"*. Each click emits one signed ResolutionEvent on the chain.

Both skills also trigger autonomously on natural-language phrasing: saying *"fix the conflicts on Miller Group"* in chat invokes `/canon-resolve miller_group` without a slash-prefix.

#### Verified end-to-end

Click-through test on `miller_group` (2026-04-26, fresh Claude Code session): *"resolve open conflicts on miller_group"* → skill triggered autonomously → `AskUserQuestion` rendered 3 picker cards → user picked `Order Fulfillment System` / `€2,200/year` / `Mary Smith` → 3 signed ResolutionEvents on the chain (`358c809b…` → `5722fd3b…` → `09f8bb9e…`) → re-call confirmed `3 → 0 open conflicts`. DB-audit (`scripts/verify-resolution-events.ts`) confirms COSE_Sign1 envelopes 794-838 hex chars, all `status='resolution'`, notes correctly track winner+losers.

---

## Architecture

- **Next.js 16** + Auth.js v5 (database session, Prisma adapter, Google OAuth)
- **Postgres** (Railway, EU-Frankfurt) for `FactEvent` + auth tables
- **Rust sidecar** (`canon-signer`) — Ed25519 + COSE_Sign1 signing, long-lived NDJSON-IPC subprocess; pure-TS verifier (`canon-verify`) is a separate binary on a separate codepath, so the verification layer doesn't trust the signing layer
- **MCP server** (`mcp/canon-mcp.ts`) — stdio transport, `@modelcontextprotocol/sdk@1.29`, 9 tools, defaults to `inazuma` workspace
- **Skills** (`.claude/skills/`) — project-local Claude Code skills using `AskUserQuestion` for terminal-button UX
- **Resend + HMAC magic-links** (`src/lib/canon/cosign-mail.ts`, `decide-mail.ts`) — both 4-eyes co-sign and `/decide` author-asks ride the same Resend pipeline; tokens are HMAC-signed under `MAGIC_LINK_SECRET` with explicit domain tags (`cosign:v1:`)
- **Opengrep trust-gate** (`.semgrep/canon-trust-gate.yml`) — three rules in CI block any `prisma.factEvent.create/update/upsert` outside of the explicit signed-write allowlist; allowlist entries have justification comments so future maintainers can't silently widen the trust boundary

---

## Trust beats

- **Separate signer + verifier binaries.** `canon-signer` (Rust, NDJSON IPC) does Ed25519 + COSE_Sign1; `canon-verify` (Rust, separate binary, separate codepath) is what `/api/verify` calls. Verification doesn't trust Canon — it pins the public key.
- **Aikido monitoring on Canon's own repo.** Findings are surfaced on the live `/app` banner with full triage breakdown — not a hidden "0 issues" claim.
- **Audit fails closed, not open.** A Gemini blip during Layer 2 tags the fact `audit:audit_unavailable`; it does NOT silently confirm.
- **MCP `canon_write` goes through the shared pipeline.** Same scan → sign → chain that Slack/Gmail/PDF ingestion uses. Agent-driven writes can't bypass trust.
- **Bit-identical events from any frontend.** Conflict resolution from the terminal (`canon_resolve`) emits a ResolutionEvent **identical** to clicking "Sign as canonical →" in the AskCanon UI. A verifier can't tell which surface the human was sitting at.
- **Opengrep trust-gate in CI.** Any new `prisma.factEvent.*` write site that's not on the documented signing path fails the build. Allowlist entries (resolve.ts, conflicts.ts, reverse-resolution.ts, cosign-resolution.ts, sync route, pipeline.ts) carry justification comments explaining why each is exempt.
- **4-eyes principle for high-risk metrics.** Money-shaped fields (ARR, MRR, contract value, churn) require a second admin's signature. Pending proposals stay on the chain even if never co-signed — auditable trace of *"someone proposed X, nobody co-signed."*
- **Two parallel audit agents** (security-focused + correctness-focused) reviewed the 4-eyes stack on 2026-04-26. Six fixes applied (commit `3a06de7`); fourteen findings documented as V2 in `bigHack/4-eyes-audit.md`. Strengths confirmed: constant-time HMAC compare, IDOR-resistant cookie binding, atomic-transaction race-condition fixes, fail-closed Gemini audit.

---

## Partner technologies (≥3 required by submission rule)

The official BBH submission rule requires using ≥3 of {Google DeepMind, Tavily, Lovable, Gradium, Pioneer/Fastino}. Canon uses **three**:

| Partner | Layer | Where in code | What it does |
|---|---|---|---|
| **Pioneer / Fastino** GLiNER-2 | 1 — extraction | `src/lib/canon/pioneer.ts` | Deterministic span-extraction over chunks. ~440-line domain-aware post-processor canonicalises entity slugs and metric keys. |
| **Google DeepMind** Gemini 2.5-flash via Vertex AI | 2 — audit | `src/lib/canon/audit.ts` | Long-context cross-check against the full source body. Fail-closed on error. |
| **Tavily** | 2.5 — external context | `src/lib/canon/tavily.ts` + `mcp/canon-mcp.ts` | Public-web search returned with explicit `unsigned: true` markers. Side-by-side with Canon's signed facts. |

**Aikido** (`src/lib/canon/aikido.ts`) is an additional Layer 3 trust contribution — not eligible toward the ≥3 rule but used as the recursive-trust beat: Canon's own repo is monitored; the live `/app` banner surfaces all findings + triage status (3 found, 1 HIGH fixed in flight, 2 LOW transparently triaged).

---

## Pitch deliverables

Inside `pitch/`:

- `DECK.md` — 7-slide read-through (~90s budget)
- `STAGE-CUES.md` — minute-by-minute cue sheet for the live demo
- `QA-APPENDIX.md` — anticipated investor questions + tight answers
- `FOUNDER-BRIEFING.md` — Nelson's inner script for the stage
- `TEST-CATALOG.md` — pre-pitch validation checklist

Recording runbook for the 4-eyes demo: [`docs/4-eyes-demo-runbook.md`](./docs/4-eyes-demo-runbook.md) — both variants (regular pick + 4-eyes co-sign) with click-by-click instructions, URLs, and pitch lines.

---

## Known gaps (V2)

Honest list of what's not yet shipped, ranked by audit severity:

- **Magic-link replay protection** — tokens are 24h reusable; no JTI / single-use guarantee. V2: persistent `MagicLinkToken{jti, consumedAt}` table.
- **Workspace role schema** — admin pool is `CANON_ADMIN_EMAILS` env list; V2 is per-workspace `UserRole` table with admin / member / guest.
- **`/decide` direct-pick** doesn't yet handle the high-risk pending state — high-risk picks via `/decide` produce a pending row, but the `/decide` UI shows them as resolved. V2: surface pending state in the decision-card.
- **Risk-tier heuristic** is regex-only; an `anual_recurring_revenue` typo classifies as low-risk. V2: default-to-high for unknown numeric metrics + an explicit allowlist.
- **OAuth providers** — Gmail / Slack flows are happy-path only; 2FA edge cases break.
- **3-way conflict resolution** — UI handles binary picks; 3+ candidates fall back to "mark all as distinct".

Full audit at [`docs/4-eyes-audit.md`](./docs/4-eyes-audit.md) — twelve more findings documented there with V2-plans.

---

## Pricing

- **Hosted:** €0.001 / signed event after 10 000 free events / month.
- **Self-host:** MIT, free. EU-only infrastructure (Railway Frankfurt) for the hosted tier.

---

## License

Canon source is licensed [MIT](./LICENSE).

For third-party-dependency license notices (incl. LGPL-3.0-or-later transitive packages flagged by Aikido that are not invoked at runtime), see [NOTICE](./NOTICE).

---

## Contact

Nelson Mehlis — `nelson.mehlis@igoultra.de`
[github.com/ThePyth0nKid/canonBigHackBerlin](https://github.com/ThePyth0nKid/canonBigHackBerlin)
