---
name: canon-resolve
description: Use this skill whenever the user wants to resolve, fix, pick, or review open conflicts in the Canon ledger from the terminal — phrases like "resolve canon conflicts", "fix the conflicts", "what conflicts are open", "pick the truth", "/canon-resolve", "show me the open ones", or any time the user mentions reviewing competing claims and choosing the canonical value. Optional argument is an entity slug to scope (e.g. "/canon-resolve miller_group"). Renders proper UI buttons via AskUserQuestion (NOT text-parsing). Never auto-resolves.
---

# /canon-resolve — interactive conflict picker with real UI buttons

Capability layer: `canon_conflicts` + `canon_resolve` MCP tools.
This skill: drives a click-pick UX using `AskUserQuestion` (no text-replies to parse).

## When to invoke

User says any of: "resolve conflicts", "fix conflicts", "what conflicts are open",
"show me the conflicts", "pick the truth", "canonize this", "/canon-resolve",
or describes wanting to review and choose between competing claims for any entity.

## Workflow

### Step 1 — Determine scope

If the user passed an entity slug (e.g. `/canon-resolve miller_group`), pass it as the `entity` arg. Otherwise list ALL open conflicts in the workspace.

### Step 2 — Call `canon_conflicts`

Args: `{ entity?, workspace?, limit? }`. Defaults: workspace=inazuma, limit=25.

The tool returns numbered groups `[1] [2] [3]` with letter-coded values `a/b/c` and factIds.

### Step 3 — Show the user a brief overview (1-2 sentences max)

Don't dump the whole tool output as text — the picker UI in the next step will surface each conflict cleanly. Just say e.g.:

> *Found 3 open conflicts on miller_group. Pick canonical value, mark as distinct, or skip for each:*

Then immediately go to Step 4. Avoid re-rendering the full picker as markdown since `AskUserQuestion` will display them as proper UI cards.

### Step 4 — Use `AskUserQuestion` for batch selection (THE KEY STEP)

This is what makes the UX feel native. Build ONE `AskUserQuestion` call with up to 4 questions (one per conflict group). For each conflict group, build a question like this:

```
question: "Pick the canonical value for <entity> · <metricKey>"
header:   "<short-label>"      // ≤12 chars, e.g. "miller·price"
multiSelect: false
options: [
  // Top 2-3 values become options (label = the displayValue from the picker)
  { label: "<value-a>",  description: "<N> fact(s) · sources: <kinds>" },
  { label: "<value-b>",  description: "<N> fact(s) · sources: <kinds>" },
  { label: "Mark as distinct records", description: "All values stay active — signed acknowledgement that they are independent records" },
  { label: "Skip for now",             description: "Leave this conflict open" },
]
```

Constraints baked in by AskUserQuestion:
- 1-4 questions per call → batch up to 4 conflict groups per round
- 2-4 options per question → if a group has >2 values, include the top 2 by fact-count + "Mark as distinct" + "Skip" (the user can still see all values in the canon_conflicts overview if needed; for a 4+ value group, mention this in the question text and tell the user to use "Other" to free-type a letter like "c" or "d" if they want a value that's not in the top 2)
- "Other" is auto-added by the runtime — no need to include it manually
- Header MUST be ≤12 chars — use abbreviations like `miller·pric`, `gonz·renew`, `g1`, `g2` if needed

### Step 5 — Map each answer to a `canon_resolve` call

The user's selection comes back as `answers[<question-text>] = <chosen-label>`. For each question:

- **Selected value label** (e.g. "€2,200/year"): call `canon_resolve` with
  - `mode: "canonical"`
  - `entity`, `metricKey` from the conflict group
  - `winnerFactId`: any factId from that letter's factIds array (in canon_conflicts output)

- **"Mark as distinct records"**: call `canon_resolve` with
  - `mode: "distinct"`
  - `entity`, `metricKey` from the conflict group
  - `candidateFactIds`: ALL factIds across ALL letters in the group

- **"Skip for now"**: no tool call. Note in summary.

- **"Other"** (free text): try to interpret literally — if user typed "skip" → skip, "distinct" → distinct, a letter like "c" → canonical for that letter, otherwise ask a clarifying question.

Sequential calls — never parallel — because each `canon_resolve` extends the same hash chain and parentHash needs the previous tip.

### Step 6 — Summarize results

Compact result table after all signs land. Quote `resolutionFactId` + `eventHash` per pick — they are the cryptographic proof:

```
✓ Resolved 2 of 3:

  miller·price    → canonical (€1,999)        f_res_a3b1…  event 8f3e2a1d…
  miller·poc      → distinct (3 records)      f_dist_c91…  event 4b9c7e8f…
  gonzalez·renew  → skipped (still open)
```

### Step 7 — If more conflicts remain

If `canon_conflicts` returned more than 4 groups and the user only got asked about 4 in Step 4, ask if they want to continue with the next batch. If yes → repeat Steps 4-6 with the next 4 groups.

### Step 8 — Optional verify

Re-call `canon_conflicts` with the same scope and show "N open conflicts → M open conflicts" to demonstrate the chain extension worked. Skip if the user said "all done" or shows fatigue.

## Anti-patterns

- ❌ **Don't render the conflict list as text and ask "reply with 1:a, 2:distinct".** That was the old UX. Use `AskUserQuestion` — it gives clickable buttons in the terminal.
- ❌ **Don't auto-pick "the most popular" or "the most recent" value.** The whole point is the human's call.
- ❌ **Don't combine multiple resolves into one call.** Each is one signed ResolutionEvent.
- ❌ **For mode="distinct", include ALL factIds across ALL letters.** Not just one cluster. The semantic is "these are all separate records", not "these candidates only".
- ❌ **Don't summarize away the resolutionFactId or eventHash.** Quote them verbatim — they are the cryptographic proof.

## Pitch beat this enables

User: *"/canon-resolve miller_group"*
Claude calls `canon_conflicts` → says "3 open conflicts, pick for each:" → renders 3 question-cards via AskUserQuestion (proper UI buttons, no syntax to remember).
User clicks: €1,999 / Mark as distinct / Skip.
Claude dispatches 2 `canon_resolve` calls → quotes ResolutionEvent IDs back → re-runs `canon_conflicts` → "3 → 1 open conflicts".
User refreshes canon.ultranova.io → AskCanon fight cards for those conflicts are gone, ResolutionEvents in the audit chain.

**Same truth, three frontends: web-click, terminal-buttons, raw-MCP — bit-identical to a verifier.**
