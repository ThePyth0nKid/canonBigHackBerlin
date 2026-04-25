# P1-06 — README + pitch docs sync to single-workspace narrative

**Owner**: writing/editing agent (technical writing)
**ETA**: 90min
**Blocks**: submission package readiness

---

## Goal

Rewrite `README.md` and the `pitch/` slide+deck files so they reflect the **post-pivot architecture** — single workspace, drop-your-data + connect-your-channels narrative, all four BBH partner integrations explicitly named (Gemini / Pioneer / Tavily / Aikido), no overclaim on Layer 3 / long-context.

## Why now

- Architect feedback: "explicit partner attribution = jury reward"
- Validator: current `pipeline.ts:8` comment "Layer 3 = local scan + Aikido banner" overclaims
- User pivot: README still mentions two workspaces / Northwind in places — confusing
- BBH submission requires ≥3 partner integrations clearly identified — Gemini, Pioneer, Tavily, Aikido all in scope, must be explicit

## Context to read first

- [`pitch/GAMEPLAN.md`](../GAMEPLAN.md) — locked decisions
- [`pitch/context/SYSTEM.md`](../context/SYSTEM.md) — current architecture truth
- Current `README.md` — find and fix overclaims
- All `pitch/slide-*.md` — find references to "northwind workspace" / "two workspaces"

## Constraints

- **Don't add features in docs that don't exist in code**. Verify every claim against [SYSTEM.md](../context/SYSTEM.md).
- **Don't remove the original BBH track manifest** if any exists (check `obsidian-vault/` if linked)
- **Honest framing**:
  - "Aikido watches the signer" ✓ (NOT "Aikido is Layer 3 of the pipeline")
  - "Gemini extended-context audit (~120k chars)" ✓ if context-bump didn't happen yet, OR "Gemini long-context audit (500k chars)" if D8 was applied (P2)
  - "Tavily web search returns external context with `unsigned: true`" ✓
  - "Custom Semgrep trust-gate rule" ✓ if P1-04 landed; otherwise omit

## Step-by-step

### 1. Audit current README (~10min)

```bash
grep -n -i "northwind\|two workspace\|workspaces tab\|switcher" README.md
grep -n -i "long-context\|layer 3\|aikido layer" README.md
```

List every line that needs editing.

### 2. Rewrite README structure (~40min)

Target ~150-line README with these sections:

```markdown
# Canon — A signed fact ledger for AI agents

> One sentence: AI agents act on facts that nobody signed. Canon makes facts cryptographically provable.

## What this is
- Trust pipeline: source → Pioneer (extract) → Gemini (audit) → local scan → Ed25519 signer → hash chain
- /app — drop your data, see facts canonized, resolve conflicts on-chain
- MCP server — `canon_lookup`, `canon_search`, `canon_cite`, `canon_diff` for any agent

## Live demo
- canon.ultranova.io
- Login with Google
- Drop a JSON / CSV / PDF, watch the pipeline run, click a fact for cryptographic proof

## How agents use it
[short MCP install snippet + the 4 tool calls]

## Partner integrations (BBH 2026 eligible tech)
- **Pioneer / Fastino GLiNER-2** — Layer 1 span extraction (every free-form chunk)
- **Google Gemini 2.5-flash (Vertex AI)** — Layer 2 audit (every draft, fail-soft)
- **Tavily** — external web search returning `unsigned: true` results (MCP tool `canon_external_lookup`)
- **Aikido** — code & supply-chain SAST for the Canon repo itself, surfaced as live triage in /app
- **Custom trust-gate rule** — `.semgrep/canon-trust-gate.yml` enforces signer-only writes (if P1-04 landed)

## Architecture in 60 seconds
[ASCII diagram + 5 bullets]

## Run locally
[env setup + commands]

## Verify chain
[canon-verify binary + offline replay]

## License + Notices
- Code: MIT
- Transitive LGPL deps acknowledged in NOTICE
```

### 3. Rewrite pitch/DECK.md (~20min)

Key edits:
- Remove "two workspaces" framing
- Replace with "drop dataset + connect channels = unified canonical view"
- Strengthen partner naming (model+vendor explicit)
- Adopt Green Team's recursive-trust sentence:
  > "Canon signs your facts; Aikido watches the signer; Gemini audits the claim before the pen touches paper."

### 4. Update individual slides (~20min)

| Slide | Edit |
|---|---|
| slide-01-hook.md | Hook stays, just check no "two workspaces" framing |
| slide-02-solution.md | Remove Northwind references, frame as "your-business view" |
| slide-03-architecture.md | Update diagram captions, name Gemini 2.5-flash + Pioneer GLiNER-2 explicitly, add Tavily as external context |
| slide-04-live-demo.md | Demo flow: pre-loaded inazuma → drop ONE small file → conflict surfaces → resolve |
| slide-05-technical-depth.md | Add: Semgrep trust-gate rule, Gemini reasoning in modal, fail-soft on outage |
| slide-06-qontext-meta.md | This is the Qontext-track-specific slide; verify alignment with single-workspace |
| slide-07-open-source-ask.md | Stays mostly; verify license + repo URL |

### 5. QA-APPENDIX update (~5min)

Update Q&A entries for jury anti-attacks (per Red Team findings):
- Q: "What customer data does Aikido see?" → A: "None. Aikido scans Canon's source code, not user data — by design. We add Layer-2 Gemini audit + local scan on every draft to handle data-side trust."
- Q: "What if Gemini is down?" → A: "Fail-soft. Status stays 'active' with `notes='audit:offline'`. We never silently flip facts to superseded on outage. (Reference: pipeline.ts decide())"
- Q: "Prompt injection through Slack messages?" → A: "Source bodies go in user-role parts of the multi-turn Gemini input, not interpolated into the system prompt. The model treats them as data, not instructions."
- Q: "Long-context — really 1M tokens?" → A: "We use Gemini 2.5-flash with [120k|500k] chars of source body — a meaningful slice, not the full 1M window. Honest about scope."

## Acceptance criteria

- README opens with one-sentence pitch, ends with license, fits in <250 lines
- 4 BBH partners explicitly named with role (Pioneer, Gemini, Tavily, Aikido)
- Semgrep rule mentioned IF P1-04 landed; omitted otherwise
- No "northwind" string anywhere in README + DECK + slides
- "Aikido watches the signer" wording adopted; "Layer 3" claim removed
- All claims have a corresponding code reference in SYSTEM.md (no doc-only features)

## Files to touch

- `README.md`
- `pitch/DECK.md`
- `pitch/slide-01..07.md`
- `pitch/QA-APPENDIX.md`
- `pitch/STAGE-CUES.md` (review for outdated workspace references)
- `pitch/FOUNDER-BRIEFING.md` (review)

Do NOT touch `pitch/TEST-CATALOG.md` — that's the technical test list, separate concern.

## Risk

- **Doc-code drift**: agent might restate aspirational features. Verify each claim against current `src/`.
- **Slide layout breakage**: slides are Markdown — one stray bullet shouldn't break presentation but verify in `pitch/DECK.md` header that it still indexes all slides.

## Hand-off agent

Use `general-purpose` with technical-writing capability. Brief in [`pitch/agents/BRIEFS.md`](../agents/BRIEFS.md#p1-06). Critical: agent must read SYSTEM.md FIRST and not invent features.
