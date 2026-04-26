---
name: canon-resolve
description: Use this skill whenever the user wants to resolve, fix, pick, or review open conflicts in the Canon ledger from the terminal — phrases like "resolve canon conflicts", "fix the conflicts", "what conflicts are open", "pick the truth", "/canon-resolve", "show me the open ones", or any time the user mentions reviewing competing claims and choosing the canonical value. Optional argument is an entity slug to scope (e.g. "/canon-resolve miller_group"). Renders a numbered checkbox-style picker; NEVER auto-resolves — every pick must be explicit.
---

# /canon-resolve — interactive conflict picker (terminal-native)

Capability layer: `canon_conflicts` + `canon_resolve` MCP tools.
This skill: the human-in-the-loop checkbox-style picker UX around them.

## When to invoke

User says any of: "resolve conflicts", "fix conflicts", "what conflicts are open",
"show me the conflicts", "pick the truth", "canonize this", "/canon-resolve",
or describes wanting to review and choose between competing claims for any entity.

## Workflow

### Step 1 — Determine scope

If the user passed an entity slug (e.g. `/canon-resolve miller_group`), pass it as the `entity` arg. Otherwise list ALL open conflicts in the workspace.

### Step 2 — Call `canon_conflicts`

Args: `{ entity?, workspace?, limit? }`. Defaults: workspace=inazuma, limit=25.

The tool already returns a pre-formatted picker with `[1] [2] [3]` group numbers and `a) b) c)` value letters per group, plus the factIds for each cluster. **Do not re-format it** — render verbatim.

### Step 3 — Render the picker + reply-format hint

Show the tool's output as-is, then append the interaction prompt:

```
Reply with picks. Format:
  <#>:<letter>      e.g.  "1:a"        → sign letter-a as canonical for group #1
  <#>:distinct                           → mark all values in group #1 as separate records
  <#>:skip                               → leave group #1 open
  multiple OK:      "1:a, 2:distinct, 3:skip"
  shorthand:        "all canonical:a"   → pick letter-a for every group (use carefully)

Awaiting your choice…
```

### Step 4 — Wait for the human reply, parse, validate

Parse the reply into a list of `{ group: number, action: 'canonical'|'distinct'|'skip', letter?: string }` ops.

Validate:
- Each `<#>` must be in range of the rendered groups
- Each `<letter>` must exist in that group's value list
- For `distinct` mode, the group must have ≥2 candidates (always true for shown conflicts, but double-check)

If anything is ambiguous or invalid, ask before dispatching — never guess.

### Step 5 — Dispatch one `canon_resolve` call per pick

For each parsed op:

- **`<#>:<letter>`** (canonical pick):
  - `mode: 'canonical'`
  - `entity`, `metricKey` from the group
  - `winnerFactId`: pick ANY one factId from that letter's cluster (the picker output lists them)

- **`<#>:distinct`** (separate records):
  - `mode: 'distinct'`
  - `entity`, `metricKey` from the group
  - `candidateFactIds`: **ALL factIds across ALL letters** in the group (every fact the human just confirmed as a distinct record)

- **`<#>:skip`**: no tool call. Note "skipped" in the summary.

Make these calls **sequentially**, not in parallel — each call appends to the same hash chain and the parentHash needs the previous tip.

### Step 6 — Summarize results

Show a compact result table with the resolutionFactId + eventHash per pick:

```
✓ Resolved 2 of 3 conflicts:

  [1] miller_group · per_seat_price → canonical (€1999)
      resolution: f_res_a3b1…   event: 8f3e2a1d…   superseded: 2 facts

  [2] miller_group · seat_count    → distinct (3 records)
      resolution: f_dist_c91…   event: 4b9c7e8f…   superseded: 0 facts

  [3] gonzalez_inc · renewal_date  → skipped (still open)
```

Quote the resolutionFactIds + eventHashes verbatim. They are the cryptographic proof.

### Step 7 — Verify

Optional but high-value: re-call `canon_conflicts` (same scope) and show the new count. The drop (e.g. "6 → 4 open conflicts") is the demo beat that proves the chain extension worked.

## Anti-patterns

- ❌ **Don't auto-pick "the most popular" or "the most recent" value.** The whole point of this skill is the human's call.
- ❌ **Don't combine multiple resolves into one call.** Each is one signed ResolutionEvent.
- ❌ **For mode="distinct", include ALL factIds across ALL letters.** Not just one cluster. The semantic is "these are all separate records", not "these candidates only".
- ❌ **Don't skip the verify step in demo contexts.** Showing the conflict count drop (6 → 5) is the visible proof of the chain extension.
- ❌ **Don't summarize away the resolutionFactId or eventHash.** The user (or anyone reviewing the chain) needs them to verify offline.

## Pitch beat this enables

User in terminal: *"Resolve all open conflicts on Miller Group."*
Claude calls `canon_conflicts({entity:'miller_group'})` → renders 3 fight-cards inline.
User: *"1:a, 2:distinct, 3:skip"*
Claude calls `canon_resolve` twice → quotes the ResolutionEvent IDs back → re-runs `canon_conflicts` → conflicts visibly dropped (3 → 1).
User refreshes canon.ultranova.io → AskCanon fight cards for those conflicts are gone, ResolutionEvents visible in the audit chain.

**Same truth, three frontends: web-click, terminal-skill, raw-MCP. Bit-identical to a verifier.**
