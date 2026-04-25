# Canon — Master Gameplan & Index

**Submission**: Sun 2026-04-26 14:00 · Big Berlin Hack 2026 · Track Qontext
**Now**: Sat 2026-04-25 ~22:45 → **~15h remaining**
**Solo build · cloud demo at canon.ultranova.io**

This is the **index**. It points into focused plan docs and context docs.
Each plan doc is self-contained — an agent can pick up cold, read it, do the work.
Each context doc is reference material agents can read before touching that area.

---

## How to use these docs

```
pitch/
  GAMEPLAN.md            ← you are here · master index, priority order, decisions
  plans/                 ← priority-ordered work units (each one agent-ready)
    P0-01-bulk-reload-dataset.md
    P0-02-audit-bugs.md
    P0-03-workspace-pivot.md
    P1-04-aikido-semgrep.md
    P1-05-gemini-visibility.md
    P1-06-tavily-panel.md
    P1-07-readme-pitch-sync.md
    P2-08-robust-live-upload.md
    P3-09-pitch-performance.md
  context/               ← reference: read before touching the area
    SYSTEM.md            ← architecture overview, key files, module map
    DATABASE.md          ← schema, prod state, query patterns
    PIPELINE.md          ← sign loop + hash chain + audit gates
    UI.md                ← /app, components, conventions
  agents/
    BRIEFS.md            ← hand-off templates + per-plan agent prompts
```

**Priority semantics:**
- **P0** — must fix or core demo flow breaks. Block submission.
- **P1** — strong polish. Substantially improves jury impact.
- **P2** — bonus. Only if P0+P1 done by 04:00 with energy left.
- **P3** — pitch performance (script, video). User said "am Ende".

---

## Decisions locked

These are settled — agents must respect, not re-litigate.

| # | Decision | Reasoning |
|---|---|---|
| D1 | **Single workspace UI**: only `inazuma`. No switcher. No `all` or `northwind` tabs. | Cleaner story. User pivot Sat 22:00. |
| D2 | **Delete `workspace='northwind'` rows** from prod DB. Hard-delete, not hide. | User explicit. Clean ledger. |
| D3 | **Sync route writes to `inazuma`** workspace. Slack/Gmail/PDF synthetic data lands alongside real Qontext data — same company, multiple sources. | One business view. |
| D4 | **Aikido stays cosmetic + honest** in code-comments. Reword "Layer 3" claim to "watches the signer". | Validator: Aikido does not gate `decide()`. |
| D5 | **Aikido custom rule via Semgrep** (P1-04), not Aikido API. Local rule file `.semgrep/canon-trust-gate.yml`. | Architect: Aikido custom-rule API tier risk too high. |
| D6 | **No deploys during in-flight prod ingest** unless user signals "kill it". | Rolling restart kills SSE pipeline. |
| D7 | **Sleep window 05:30 → 09:00 non-negotiable**. | Pitch performance > one extra feature. |
| D8 | **Gemini context: bump `MAX_CONTEXT_CHARS` to 500_000** (now 120k). Removes "long-context" overclaim. | 30k tokens is 3% of 1M window. |
| D9 | **Redacted facts not reversible by design.** No encrypted shadow column. | "Canon ist nicht der nächste Datenzwischenspeicher." |
| D10 | **Gemini reasoning displayed in proof modal**: confidence + contradiction quote per superseded fact. | Architect's high-ROI pick. |
| D11 | **Live UI upload deprioritized**. Bulk-load via existing `scripts/ingest-qontext.ts` script — proven path. Live drag-drop UI demo path = single small file (clients.json), not 306-folder. | User Sat 22:45 — too much time control whether large uploads survive. |
| D12 | **Tavily gets visible UI surface in /app** — third-partner BBH requirement is currently MCP-only (terminal-side), invisible during live demo. Add per-entity `<ExternalContextPanel>` that lazy-fetches Tavily, renders top 3 with `unsigned` badge. | User Sat ~23:00. Tavily as auxiliary partner needs demo-side visibility. |
| D13 | **Aikido Semgrep deferred to Sunday morning** (post-sleep). Authoring SAST patterns at 02:00 is bug-bait. Tavily UI takes priority Saturday night because it's the third-partner BBH requirement. | Sun-morning sharp time gives cleaner rule + cleaner CI hookup. |

---

## Master priority list

| Priority | ID | Title | ETA | Plan doc |
|---|---|---|---|---|
| P0 | 01 | Bulk-reload Qontext dataset into prod | 30min | [plans/P0-01-bulk-reload-dataset.md](plans/P0-01-bulk-reload-dataset.md) |
| P0 | 02 | Audit-layer bug fixes (prompt injection + fail-soft + skipAudit badge) | 80min | [plans/P0-02-audit-bugs.md](plans/P0-02-audit-bugs.md) |
| P0 | 03 | Workspace pivot (delete northwind, single ws, sync→inazuma) | 45min | [plans/P0-03-workspace-pivot.md](plans/P0-03-workspace-pivot.md) |
| P1 | 04 | Aikido Semgrep custom trust-gate rule | 90min | [plans/P1-04-aikido-semgrep.md](plans/P1-04-aikido-semgrep.md) |
| P1 | 05 | Gemini reasoning in proof modal | 90min | [plans/P1-05-gemini-visibility.md](plans/P1-05-gemini-visibility.md) |
| P1 | 06 | Tavily external-context panel in /app | 90min | [plans/P1-06-tavily-panel.md](plans/P1-06-tavily-panel.md) |
| P1 | 07 | README + pitch docs sync (single-ws narrative + Tavily + Semgrep) | 90min | [plans/P1-07-readme-pitch-sync.md](plans/P1-07-readme-pitch-sync.md) |
| P2 | 08 | Robust live UI upload (sign-direct-first + per-batch retry) | 90min | [plans/P2-08-robust-live-upload.md](plans/P2-08-robust-live-upload.md) |
| P3 | 09 | Pitch script + Loom + side-challenge submissions | 2h | [plans/P3-09-pitch-performance.md](plans/P3-09-pitch-performance.md) |

**Sum P0-P1**: ~8.5h pure code. With deploy + smoke-test buffer: ~10h.
**Available before sleep gate**: 22:45 → 05:30 = ~6.5h. **Very tight — P1-04 (Aikido Semgrep) is the candidate to drop if running long, since P1-06 (Tavily) is the third partner requirement.**

---

## Time budget

| Window | Plan |
|---|---|
| 22:45 → 23:30 (45min) | P0-01 dataset bulk-reload — kick off the script, watch progress |
| 23:30 → 00:50 (80min) | P0-02 audit bugs (parallel to P0-01 if reload is hands-off) |
| 00:50 → 01:35 (45min) | P0-03 workspace pivot |
| 01:35 → 03:05 (90min) | P1-05 Gemini reasoning in proof modal — high-ROI before sleep |
| 03:05 → 04:35 (90min) | P1-06 Tavily panel — the third-partner requirement made visible |
| 04:35 → 05:30 (55min) | P1-07 README + pitch docs sync (compressed scope: README only, slides post-sleep) |
| **05:30 → 09:00 (3.5h)** | **SLEEP** — non-negotiable |
| 09:00 → 10:30 (90min) | P1-04 Aikido Semgrep rule (deferred to morning when fresh — SAST authoring needs clear head) |
| 10:30 → 11:30 (1h) | P1-07 finish: slide updates + QA appendix |
| 11:30 → 13:00 (90min) | P3-09 pitch script + Loom |
| 13:00 → 14:00 (1h) | Buffer + final smoke test + submit |
| **dropped if late** | P2-08 robust live upload — only if everything else done by 11:00 |

---

## Demo-day pre-flight (10min before pitch)

- [ ] `claude mcp list` shows `canon: ✓ Connected`
- [ ] canon.ultranova.io/app loads, shows ≥3000 facts in unified view (single workspace, no switcher)
- [ ] At least 1 unresolved conflict surfaces with both `canonical` and `distinct` resolution paths
- [ ] AikidoRepoBanner renders (live API call working)
- [ ] **Drop 1 small file (e.g. one client record) → sees pipeline tick INIT → DONE in <30s**
- [ ] Proof modal opens, shows eventHash + COSE bytes + **Gemini reasoning + confidence** (P1-05)
- [ ] MCP `canon_lookup({entity:"miller_group"})` returns conflict signal
- [ ] Semgrep custom rule runs locally `npx semgrep --config .semgrep/canon-trust-gate.yml src/` exits clean

## Submission package

- [ ] Public GitHub repo with README, LICENSE (MIT), NOTICE (LGPL deps), `.env.example`
- [ ] Live demo URL: canon.ultranova.io
- [ ] 2-min Loom video link
- [ ] Side-challenge submissions where eligible (Aikido, Pioneer, Tavily, DeepMind)

---

## Risk register (live — update if anything fires)

| Risk | Trigger | Mitigation |
|---|---|---|
| Bulk-reload script fails | Postgres lag / Pioneer quota / Vertex auth | Already-tested path; if fails, fallback to `scripts/ingest-qontext.ts --no-audit` |
| Pioneer endpoint down for live demo drop | API 5xx | Direct-drafts (typed mappers like `clientToDrafts`) don't need Pioneer — small-file demo still works |
| Aikido API auth fails | `getRepoBanner()` throws | Banner falls back to "offline" pill, doesn't break /app |
| Wifi flake on stage | Total signal loss | Pre-load demo state. Have screencast backup ready by 11:00 Sun |
| User exhaustion | Past 03:00 | Sleep gate non-negotiable — D7 |
| Semgrep rule breaks CI | Bad pattern syntax | Rule lives in repo, CI optional. If broken, omit CI integration, keep README claim |

---

*Last updated: 2026-04-25 22:45 · author: Claude Opus + Nelson*
