# Canon

> One file. Every source. Every agent.

**Live:** [canon.ultranova.io](https://canon.ultranova.io) · **Repo:** [github.com/ThePyth0nKid/canonBigHackBerlin](https://github.com/ThePyth0nKid/canonBigHackBerlin) · **License:** [MIT](./LICENSE)

Canon is a cryptographically signed, hash-chained context layer for AI
agents. Every fact is extracted from a real source (Slack, Gmail, PDF,
…), audited, scanned, signed with Ed25519, and chained into an audit
trail your agents can verify offline — over the Model Context Protocol.

Built solo at **Big Berlin Hack 2026** (Track: Qontext) by Nelson Mehlis.

## What it does

```
Slack / Gmail / PDF / Qontext-dataset / …
       │
       ▼
┌────────────────────┐
│ 1. Pioneer         │  deterministic span extraction (Fastino GLiNER-2)
│    FactDraft[]     │
└────────────────────┘
       │
       ▼
┌────────────────────┐
│ 2. Gemini 2.5-flash│  long-context audit (~120k tokens)
│    confirm/contradict (fail-closed on error)
└────────────────────┘
       │
   ┌───┴───┐
   ▼       ▼
┌───────┐ ┌──────────────────┐
│Tavily │ │ 3. Aikido + scan │  secret/PII refusal · repo-health
│external│ │    RedactionEvent │  (recursive trust beat)
│context │ └──────────────────┘
│unsigned│        │
└───────┘        ▼
   │       ┌────────────────────┐
   │       │ 4. canon-signer    │  Ed25519 + COSE_Sign1, hash-chained
   │       │    FactEvent       │  (per-workspace chain)
   │       └────────────────────┘
   │              │
   ▼              ▼
   MCP server  →  canon_workspaces · canon_lookup · canon_search ·
                  canon_cite · canon_diff · canon_external_lookup
                  (Tavily, unsigned) · canon_write · canon_conflicts ·
                  canon_resolve

   .claude/skills/  →  /canon-write   (preview → click-confirm → sign)
                       /canon-resolve (numbered picker → click → sign
                                       ResolutionEvent on the chain)
```

**Workspaces (federation):**
- **`northwind`** — demo workspace (Slack `#sales`, Gmail `[canon-demo]`, board-deck PDF).
  ~50 active facts, ACME 50-vs-40 seats live conflict.
- **`inazuma`** — Qontext-supplied enterprise dataset (400 clients, 400 vendors,
  1260 employees, 11.9k emails, 2.9k conversations, 10.8k internal Q&A).
  ~310 active facts after `scripts/ingest-qontext.ts`. **6 industry conflicts surface
  straight from the dataset's own duplicates** (Miller Group, Gonzalez Inc, Johnson
  Group; Huang LLC, Williams Group, Martin Ltd) plus 40 PII redactions caught
  by Layer 3 in contact-email fields. Switch via `/app?ws=inazuma`.

Each workspace has its own hash chain. The MCP server scopes by workspace
(default `northwind`).

## Quick start

```bash
git clone https://github.com/ThePyth0nKid/canonBigHackBerlin
cd canonBigHackBerlin
npm install
cp .env.example .env.local           # fill in DATABASE_URL, OAuth, API keys
npx prisma db push
npm run dev                          # localhost:3000
```

Then open `localhost:3000/login`, sign in, and click **Sync now** on
`/app` to ingest the seeded Slack + Gmail + PDF Northwind demo. For
the Qontext-supplied Inazuma dataset, drop the `Dataset/` folder under
`demo/qontext/` and run:

```bash
npx tsx scripts/ingest-qontext.ts --no-audit --reset
open "http://localhost:3000/app?ws=inazuma"
```

## Partner technologies (≥3 required by submission rule)

The official BBH submission rule requires using ≥3 of {Google DeepMind,
Tavily, Lovable, Gradium, Pioneer/Fastino}. Canon uses three:

| Partner | Layer | Where in code | What it does |
|---|---|---|---|
| **Pioneer / Fastino** GLiNER-2 | 1 — extraction | `src/lib/canon/pioneer.ts` | Deterministic span-extraction over chunks. ~440-line domain-aware post-processor canonicalises entity slugs and metric keys. |
| **Google DeepMind** Gemini 2.5-flash via Vertex AI | 2 — audit | `src/lib/canon/audit.ts` | Long-context cross-check against the full source body. Fail-closed on error: a Gemini blip tags the fact `audit:audit_unavailable` rather than silently confirming. |
| **Tavily** | 2.5 — external context | `src/lib/canon/tavily.ts` + `mcp/canon-mcp.ts` | Public-web search returned with explicit `unsigned: true` markers. Side-by-side with Canon's signed facts so the agent (and audit log) sees exactly which is which. |

Aikido (`src/lib/canon/aikido.ts`) is an additional **Layer 3 trust
contribution** — not eligible toward the ≥3 rule but used as the
recursive-trust beat: Canon's own repo is monitored; the live `/app`
banner surfaces all findings + triage status (3 found, 1 HIGH fixed in
flight, 2 LOW transparently triaged).

## MCP integration

Canon's MCP server exposes 9 tools to any MCP-compatible agent (Claude
Desktop, Claude Code, Cursor, Windsurf, Zed, …):

| Tool                     | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `canon_workspaces`       | List available workspaces (northwind, inazuma) with active fact counts |
| `canon_lookup`           | Signed facts about an entity (workspace-scoped)         |
| `canon_search`           | Free-text substring search (workspace-scoped)           |
| `canon_cite`             | Full COSE_Sign1 audit-chain proof for one factId        |
| `canon_diff`             | What changed for an entity since an ISO date             |
| `canon_external_lookup`  | UNSIGNED Tavily web context, side-by-side with signed   |
| `canon_write`            | Sign a new FactEvent through the shared scan→sign pipeline (`manual:agent-claude:<ISO>` source ref) |
| `canon_conflicts`        | List open `(entity, metric)` conflicts as a numbered `[1] [2] [3]` picker with `a/b/c` value letters |
| `canon_resolve`          | Sign a ResolutionEvent at the chain tip (`canonical` pick or `distinct` records) |

Wire it up:

```bash
claude mcp add --scope user canon -- npx tsx /absolute/path/canon/mcp/canon-mcp.ts
```

Or copy `mcp/claude-desktop-config.example.json` into
`~/Library/Application Support/Claude/claude_desktop_config.json`.

### Terminal-native skills (Claude Code)

Two project-local skills under `.claude/skills/` wrap the write/conflicts/
resolve tools in a click-pick UX using Claude Code's `AskUserQuestion`
(no text-syntax to memorise — actual UI buttons in the terminal):

- **`/canon-write`** — capture entity/claim/source in chat, render a preview
  block, then a single 3-button question (Sign / Edit / Cancel). On
  confirm, pipes through the shared sign-pipeline and quotes back the
  signed `factId` + `eventHash` + `parentHash`.
- **`/canon-resolve [entity?]`** — call `canon_conflicts`, render a
  one-line overview, then `AskUserQuestion` with up to 4 questions
  (one per conflict group), each offering the top 2 candidate values
  plus *"Mark as distinct records"* and *"Skip for now"*. Each click
  emits one signed ResolutionEvent on the chain. After all picks land,
  re-runs `canon_conflicts` to show the conflict count drop.

Both skills also trigger autonomously on natural-language phrasing (the
description is "pushy"): saying *"fix the conflicts on Miller Group"*
in chat invokes `/canon-resolve miller_group` without a slash-prefix.

The MCP gives **capabilities**; the skills give **workflow**. One
signed truth, three frontends — web-click, terminal-buttons, raw-MCP —
all writing bit-identical events into the same hash chain.

## Architecture

- **Next.js 16** + Auth.js v5 (database session, Prisma adapter)
- **Postgres** (Railway) for `FactEvent` + `User` + auth tables
- **Rust sidecar** (`canon-signer`) for Ed25519 + COSE_Sign1 signing,
  long-lived NDJSON-IPC subprocess
- **Rust verifier** (`canon-verify`) — separate binary, separate
  codepath, used by `/api/verify` so the verification layer doesn't
  trust the signing layer
- **MCP server** (`mcp/canon-mcp.ts`) — stdio transport,
  `@modelcontextprotocol/sdk@1.29`

## Pitch deliverables

See `pitch/` for:

- `DECK.md` — 7-slide read-through (~90s budget)
- `STAGE-CUES.md` — minute-by-minute cue sheet for the live demo
- `QA-APPENDIX.md` — anticipated investor questions + tight answers
- `FOUNDER-BRIEFING.md` — Nelson's inner script for the stage
- `TEST-CATALOG.md` — pre-pitch validation checklist

## Pricing

- Hosted: **€0.001 / signed event** after 10 000 free events / month.
- Self-host: MIT, free. EU infrastructure (Railway Frankfurt) for the
  hosted tier.

## License

Canon source is licensed [MIT](./LICENSE).

For third-party-dependency license notices (incl. LGPL-3.0-or-later
transitive packages flagged by Aikido that are not invoked at runtime),
see [NOTICE](./NOTICE).

## Trust beats

- The signer (`canon-signer`) and the verifier (`canon-verify`) are
  separate binaries with separate code paths. Verification doesn't trust
  Canon — it pins the public key.
- Canon's own repository is monitored by Aikido. Findings are surfaced
  on the live `/app` banner with full triage breakdown — not a hidden
  "0 issues" claim.
- Audit failures (Layer 2) fail closed, not open: a Gemini blip tags
  the fact `audit:audit_unavailable` instead of silently confirming it.

## Contact

Nelson Mehlis — nelson.mehlis@igoultra.de
[github.com/ThePyth0nKid/canonBigHackBerlin](https://github.com/ThePyth0nKid/canonBigHackBerlin)
