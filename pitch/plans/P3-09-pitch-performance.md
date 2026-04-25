# P3-08 — Pitch script + Loom + side-challenge submissions

**Owner**: writing/recording (human-driven)
**ETA**: 2h total (60min script, 30min Loom, 30min submissions)
**Blocks**: nothing — happens last

---

## Goal

Lock down the on-stage performance and the recorded backup. Submit any side-challenges where Canon is eligible.

User explicit instruction: "diese Skript-Sachen erstmal komplett, da gehen wir ganz am Ende drauf nochmal ein." This is end-of-list.

## Why P3 not P1

The substance of the pitch IS the codebase + UI. Words come last. If we don't have a working demo, no script saves us. If we have a tight demo, a straightforward script is enough.

## Step-by-step

### 1. Live pitch script (~60min)

Target: 4-5 minutes on stage. Read once aloud, time it, trim to 4:30.

Structure:
```
[0:00-0:30] HOOK — "AI agents act on facts that nobody signed."
[0:30-1:30] PROBLEM + SOLUTION — Canon as cryptographic ledger of business truth
[1:30-3:00] LIVE DEMO
   - Open canon.ultranova.io
   - Show pre-loaded Inazuma view: 3000+ facts, 5+ sources, 1 unresolved conflict
   - Drop ONE small file — pipeline ticks INIT → DONE in 30s
   - Click conflict → resolve modal → distinct-records mode → signed event
[3:00-4:00] PROOF + AGENT INTEGRATION
   - Click any fact → proof modal → eventHash + COSE bytes + Gemini reasoning
   - Switch to terminal: claude_lookup miller_group → cite factId
   - Note: external Tavily search returns `unsigned: true`
[4:00-4:30] CLOSE
   - "Aikido watches the signer; Gemini audits the claim; Ed25519 seals the record."
   - "Open source. MIT. ed25519 by default. canon.ultranova.io."
```

Save in `pitch/SCRIPT-LIVE.md`.

### 2. Loom recording (~30min)

2-minute version for submission. Same beats compressed:
- 0:00-0:20 Hook + what is Canon
- 0:20-1:00 Demo: drop file → conflict surfaces → resolve
- 1:00-1:30 Proof modal + MCP lookup
- 1:30-2:00 Trust pipeline diagram + close

Record in Loom. Link in submission package.

### 3. Side-challenge submissions (~30min)

Per BBH manual, each partner has separate side-challenge submissions. Canon's eligible:

| Partner | Side-challenge | What to submit |
|---|---|---|
| **Aikido** | "Most creative use of Aikido in a hackathon project" | Recursive-trust pitch + the live banner + the Semgrep custom rule (P1-04) |
| **Pioneer / Fastino** | "Most innovative use of GLiNER-2" | Per-sentence chunking strategy + cross-source corroboration mechanism |
| **Tavily** | "Most useful integration of Tavily search" | `canon_external_lookup` MCP tool returning `unsigned: true` flag |
| **Google DeepMind** | (verify — depends on track) | Gemini 2.5-flash long-context auditor with structured response schema, fail-soft on outage |

For each: 100-200 word write-up, link to relevant code file, screenshot if helpful.

Save in `pitch/SIDE-CHALLENGES.md`.

### 4. Final submission package check

Use the GAMEPLAN.md submission checklist:
- [ ] Public repo
- [ ] README ≤250 lines
- [ ] LICENSE + NOTICE + .env.example
- [ ] Live demo URL in README
- [ ] Loom link in README
- [ ] All 4 side-challenges submitted

## Acceptance criteria

- `pitch/SCRIPT-LIVE.md` exists, 4-5 min when read aloud
- `pitch/SIDE-CHALLENGES.md` exists with 3-4 partner submissions
- Loom video uploaded + link captured
- BBH submission form filled

## Files to touch

- `pitch/SCRIPT-LIVE.md` — NEW
- `pitch/SIDE-CHALLENGES.md` — NEW
- `README.md` — add Loom link

## Risk

- **Video quality**: macOS QuickTime + Loom is fine, no fancy edit needed
- **Demo flake during recording**: pre-warm the demo (two browser tabs, MCP already loaded)

## Hand-off agent

Mostly human-driven. Could use a `general-purpose` agent to draft initial SCRIPT-LIVE.md based on slide content + DECK.md, then human refines. Brief in [`pitch/agents/BRIEFS.md`](../agents/BRIEFS.md#p3-08).
