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
Slack / Gmail / PDF
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
│    confirm/contradict
└────────────────────┘
       │
       ▼
┌────────────────────┐
│ 3. Aikido + scan   │  secret/PII refusal · repo-health
│    RedactionEvent  │
└────────────────────┘
       │
       ▼
┌────────────────────┐
│ 4. canon-signer    │  Ed25519 + COSE_Sign1, hash-chained
│    FactEvent       │
└────────────────────┘
       │
       ▼
   MCP server  →  canon_lookup, canon_search, canon_cite, canon_diff
```

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
`/app` to ingest the seeded Slack + Gmail + PDF demo content.

## MCP integration

Canon's MCP server exposes 5 tools to any MCP-compatible agent (Claude
Desktop, Cursor, Windsurf, Zed, …):

| Tool            | Purpose                                                  |
| --------------- | -------------------------------------------------------- |
| `canon_lookup`  | Get all signed facts about a customer / company         |
| `canon_search`  | Free-text substring search across active facts          |
| `canon_cite`    | Full COSE_Sign1 audit-chain proof for one fact          |
| `canon_diff`    | What changed about an entity since a date               |
| `canon_write`   | Propose a new fact (v0.2 — currently a stub)            |

Wire it up:

```bash
claude mcp add --scope user canon -- npx tsx /absolute/path/canon/mcp/canon-mcp.ts
```

Or copy `mcp/claude-desktop-config.example.json` into
`~/Library/Application Support/Claude/claude_desktop_config.json`.

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
