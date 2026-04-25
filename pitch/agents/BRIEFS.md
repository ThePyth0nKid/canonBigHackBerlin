# Agent briefing templates

**How to hand off Canon work to specialized agents.**

---

## Briefing pattern

Every agent prompt should:

1. **Goal** in one sentence
2. **Read these files first** — point at GAMEPLAN, the relevant plan doc, the relevant context doc(s)
3. **Constraints** explicit — what NOT to touch
4. **Acceptance criteria** verifiable
5. **Risk** — known traps
6. **Output expectations** — concise summary, what to commit, when to stop

Always include this universal preamble:

> You are working on Canon, a hackathon submission due Sunday 2026-04-26 14:00. Single workspace UI (post-pivot). Read `pitch/GAMEPLAN.md` for locked decisions before doing anything. **Do not deploy to Railway** unless explicitly asked — the human runs deploys. Commit locally only. Be terse in updates; the human reads diffs, not narratives.

---

## P0-01 — Bulk-reload dataset

**Agent type**: `general-purpose` (verification only) OR human-driven (script execution)

**Prompt skeleton**:
```
Goal: Verify production DB after the user runs `npx tsx scripts/ingest-qontext.ts --reset --no-audit`.

Read first:
- pitch/plans/P0-01-bulk-reload-dataset.md (the full plan)
- pitch/context/DATABASE.md

Run these queries:
1. count active inazuma facts (expect ≥3000)
2. count by status (expect mostly active, small redacted, small superseded)
3. distinct sourceRef prefixes (expect qontext:client, qontext:vendor, etc)
4. sample 5 random conflict-shaped metric groups

Report a verdict: pass/partial/fail with one-line per check. Don't modify code.
```

---

## P0-02 — Audit-layer bugs

**Agent type**: `general-purpose` (TypeScript / security comfort)

**Prompt skeleton**:
```
Goal: Implement three sub-fixes per pitch/plans/P0-02-audit-bugs.md:
  (1) prompt injection fix in audit.ts
  (2) audit_unavailable fail-soft in pipeline.ts decide()
  (3) skipAudit UI badge

Read first:
- pitch/GAMEPLAN.md
- pitch/plans/P0-02-audit-bugs.md
- pitch/context/PIPELINE.md
- pitch/context/SYSTEM.md
- src/lib/canon/audit.ts (full)
- src/lib/canon/pipeline.ts (full)

Constraints:
- DO NOT change AuditVerdict shape
- DO NOT migrate Prisma schema; pack additions into existing `notes` column
- DO NOT touch src/lib/canon/sign.ts
- Run `npx tsc --noEmit` after each sub-fix; fix any new errors before continuing

When done:
- Stage all changes with git add
- Write commit message but DON'T push or run railway up
- Reply with: "P0-02 done. Files touched: [...]. Smoke results: [...]"

Acceptance: see pitch/plans/P0-02-audit-bugs.md sub-fix sections.
```

---

## P0-03 — Workspace pivot

**Agent type**: `general-purpose`

**Prompt skeleton**:
```
Goal: Implement the single-workspace pivot per pitch/plans/P0-03-workspace-pivot.md.
Five concrete steps: DB delete northwind, shrink WORKSPACES constant, remove switcher,
update sync route to write 'inazuma', update SyncButton text.

Read first:
- pitch/GAMEPLAN.md (decisions D1-D3)
- pitch/plans/P0-03-workspace-pivot.md
- pitch/context/DATABASE.md
- pitch/context/UI.md
- src/lib/canon/view.ts (full)
- src/app/app/page.tsx (full)
- src/app/api/sync/route.ts (full)

Constraints:
- DB delete must be exactly `where: { workspace: 'northwind' }` — no other filters
- Don't drop the workspace column from schema
- Don't break MCP tools (canon_workspaces is OK to return [{slug:'inazuma'}])
- Run `npx next build` after; must compile clean

When done:
- Reply with: "P0-03 done. Northwind rows deleted: <N>. Files touched: [...]. /app smoke: [...]"
```

---

## P1-04 — Aikido Semgrep custom rule

**Agent type**: `general-purpose` (security/SAST background helps)

**Prompt skeleton**:
```
Goal: Author Canon's first custom static-analysis rule per pitch/plans/P1-04-aikido-semgrep.md.
Rule enforces "all FactEvent writes go through runPipeline()". Wire into CI + UI banner.

Read first:
- pitch/GAMEPLAN.md (decision D5: Semgrep not Aikido API)
- pitch/plans/P1-04-aikido-semgrep.md
- pitch/context/PIPELINE.md (the runPipeline contract)
- src/lib/canon/pipeline.ts (the legitimate writer)
- All other files that currently call prisma.factEvent.* — find them with:
  `grep -rn "factEvent\\.\\(create\\|update\\|upsert\\|delete\\)" src/`

Constraints:
- Rule must NOT false-positive on src/lib/canon/pipeline.ts
- Rule must NOT false-positive on legitimate delete calls in sync/route.ts (those reset synthetic data; separate concern)
- Run `npx semgrep --config .semgrep/canon-trust-gate.yml src/` and verify 0 findings on main

When done:
- Reply with: "P1-04 done. Rule fires on: <list of files if any>. CI workflow: <yes/no>. UI banner: <yes/no>."
```

---

## P1-05 — Gemini reasoning in proof modal

**Agent type**: `general-purpose` (UI + audit comfort)

**Prompt skeleton**:
```
Goal: Make Gemini's verdict visible per fact in the proof modal per pitch/plans/P1-05-gemini-visibility.md.
Pack verdict JSON in notes column, parse it with new helper, render in modal.

Read first:
- pitch/GAMEPLAN.md (decision D10: Gemini reasoning visible)
- pitch/plans/P1-05-gemini-visibility.md
- pitch/context/PIPELINE.md
- pitch/context/UI.md
- src/lib/canon/audit.ts
- src/lib/canon/pipeline.ts
- src/app/app/_components/proof-modal.tsx

Constraints:
- DO NOT migrate Prisma schema. Pack JSON in existing `notes` column with prefix `audit:<kind>:<json>`
- Backward compat: legacy `audit:reason-text` rows must still render via fallback
- Verify with: ingest a small sample, then click a fact, see audit section render

When done:
- Reply with: "P1-05 done. Files touched: [...]. Smoke: [...]"
```

---

## P1-06 — Tavily external-context panel

**Agent type**: `general-purpose` (UI + light backend)

**Prompt skeleton**:
```
Goal: Surface Tavily web search inside /app per pitch/plans/P1-06-tavily-panel.md.
New /api/external-lookup route + new <ExternalContextPanel> component, wired into
each EntitySection in page.tsx. Lazy fetch on disclosure expand.

Read first:
- pitch/GAMEPLAN.md (decision D12: Tavily gets UI surface)
- pitch/plans/P1-06-tavily-panel.md (the full plan)
- pitch/context/SYSTEM.md (Tavily already wired backend-side)
- pitch/context/UI.md
- src/lib/canon/tavily.ts (READ ONLY — backend stable, do not refactor)
- mcp/canon-mcp.ts (see how canon_external_lookup formats; reuse field semantics)

Constraints:
- TAVILY_API_KEY MUST stay server-side. Verify with: `grep -r TAVILY .next/static/` returns nothing
- Do NOT modify src/lib/canon/tavily.ts — wrap, don't refactor
- Tavily items remain `unsigned: true` always — do not sign them
- Cache 5min server-side per query
- Rate limit per user (12/min)
- Lazy fetch only on disclosure open — page load must NOT trigger Tavily calls

When done:
- Reply with: "P1-06 done. Files added: [...]. Latency p50: <ms>. Cache hit rate after 3 expand+close cycles: <%>"

Acceptance: see pitch/plans/P1-06-tavily-panel.md acceptance section.
```

---

## P1-07 — README + pitch sync

**Agent type**: `general-purpose` (technical writing)

**Prompt skeleton**:
```
Goal: Rewrite README.md and the pitch/ slide+deck files to reflect post-pivot architecture.
Strict requirement: every claim must trace to existing code, no aspirational features.

Read first (in this order):
- pitch/GAMEPLAN.md (locked decisions, especially D1, D4, D5, D8, D11, D12)
- pitch/plans/P1-07-readme-pitch-sync.md (the rewrite plan)
- pitch/context/SYSTEM.md (ground-truth what exists)
- pitch/context/PIPELINE.md (audit/scan/sign roles)
- Current README.md (what's already there to replace)
- pitch/DECK.md + pitch/slide-*.md
- pitch/QA-APPENDIX.md

Constraints:
- NO mention of "northwind" / "two workspaces" in any output file
- Adopt Green Team's recursive-trust sentence verbatim where it fits:
  "Canon signs your facts; Aikido watches the signer; Gemini audits the claim before the pen touches paper."
- Name partners explicitly: Pioneer (GLiNER-2), Gemini 2.5-flash (Vertex AI), Tavily, Aikido
- Mention Semgrep trust-gate rule ONLY IF P1-04 has landed (check `.semgrep/` dir)
- README target: ≤250 lines

When done:
- Reply with: "P1-06 done. Files rewritten: [...]. Word count: <count>. Lines: <count>."
```

---

## P2-08 — Robust live upload (only if time permits)

**Agent type**: `general-purpose`

**Prompt skeleton**:
```
Goal: Refactor /api/ingest-upload from "all-or-nothing" to streaming sign-direct-first
+ per-batch-retry per pitch/plans/P2-08-robust-live-upload.md.

Read first:
- pitch/GAMEPLAN.md
- pitch/plans/P2-08-robust-live-upload.md
- pitch/context/PIPELINE.md
- src/app/api/ingest-upload/route.ts (current state)
- src/lib/canon/pipeline.ts (signer reuse contract)

Constraints:
- Do NOT regress single-file upload (must still work in <30s)
- Signer reuse: pass same CanonSigner across multiple runPipeline() calls
- Keep SSE protocol stable — same phase names, same payload shapes

When done:
- Reply with: "P2-08 done. Files touched: [...]. Smoke results: <single-file>, <multi-file>, <Pioneer-down case>."
```

---

## P3-09 — Pitch performance

**Agent type**: `general-purpose` (writing)

**Prompt skeleton**:
```
Goal: Draft pitch/SCRIPT-LIVE.md (4-5min on-stage script) and pitch/SIDE-CHALLENGES.md
(per-partner write-ups) per pitch/plans/P3-09-pitch-performance.md.

Read first:
- pitch/GAMEPLAN.md
- pitch/plans/P3-08-pitch-performance.md
- pitch/DECK.md (after P1-06)
- pitch/slide-*.md (after P1-06)
- pitch/context/SYSTEM.md

Constraints:
- Script must time to 4-5 min when read aloud (≈600-700 words)
- Side-challenge write-ups: 100-200 words each, 4 partners (Aikido, Pioneer, Tavily, DeepMind/Gemini)
- DO NOT promise features not in code

When done:
- Reply with: "P3-09 drafts done. Word counts: SCRIPT=<n>, SIDE-CHALLENGES=<n>."
```

---

## Anti-patterns (all agents)

- ❌ Don't run `railway up` or push to git remote
- ❌ Don't migrate Prisma schema unless plan doc explicitly says to
- ❌ Don't add features not in the plan doc — scope creep is the enemy
- ❌ Don't write multi-paragraph commit messages — keep terse
- ❌ Don't change unrelated formatting / lint / refactor while doing the task
- ❌ Don't fabricate test results — run the smoke and report actual output
- ❌ Don't read files outside the specified context list — focus

## Universal smoke before "done"

After every code change:
```bash
npx tsc --noEmit       # types must compile
npx next build         # build must succeed
```

If either fails, fix before reporting done.
