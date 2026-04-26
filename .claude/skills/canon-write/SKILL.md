---
name: canon-write
description: Use this skill whenever the user wants to add, write, log, record, or sign a new fact into the Canon ledger from the terminal — phrases like "add a fact to canon", "write to canon", "log this in canon", "record this", "sign this fact", "/canon-write", or any time the user mentions creating a new signed truth in Canon. Walks the user through entity/claim/source preview-and-confirm BEFORE signing — never auto-signs without explicit human "y".
---

# /canon-write — sign a new Canon fact (preview → confirm → sign)

Capability layer: `canon_write` MCP tool (one draft through the shared scan→sign→persist pipeline).
This skill: the human-in-the-loop terminal UX around it.

## When to invoke

User says any of: "add a fact", "write to canon", "log this", "record this in canon",
"sign this", "create a canon fact", "/canon-write", or describes a one-line factual
claim they want persisted with cryptographic provenance.

## Workflow

### Step 1 — Capture the four required fields

If the user already gave them in their message, use those. Otherwise ask in one round, with sensible defaults:

- **`entity`** (slug, lowercase snake_case, e.g. `miller_group`, `gonzalez_inc`) — required
- **`claim`** (one full sentence in natural language) — required
- **`sourceExcerpt`** (1–2 lines of original text the claim is grounded in) — required.
  If the user truly has no source text, suggest reusing the claim itself, but flag it as "source = self-attested".
- **`sourceRef`** (optional; defaults to `manual:agent-claude:<ISO>`) — only ask if the user mentioned a stable external pointer
- Optional structured metric: `metricKey` + `metricValue` + `metricUnit` if the claim contains a number worth comparing for conflicts later (e.g. price, seat count, date)

Don't pepper the user with one-question-at-a-time. Ask everything missing at once, with a numbered list.

### Step 2 — Render the preview box verbatim

```
About to sign this Canon fact:
  entity:         <entity>
  claim:          "<claim>"
  sourceRef:      <sourceRef>
  sourceExcerpt:  "<excerpt>"
  workspace:      inazuma           (default; ask only if the user wants a non-default workspace)
  [metric:        <key> = <value> <unit>]    (only if provided)

Confirm?   [y] sign   [n] cancel   [e] edit a field
```

### Step 3 — Wait for the human reply

- On `y` (or "yes", "ja", "sign", "go") → proceed to step 4
- On `n` (or "no", "nein", "cancel") → confirm cancelled, do nothing
- On `e` → ask which field, update it, re-render the preview, ask again

DO NOT proceed to signing without an explicit affirmative.

### Step 4 — Call `canon_write`

Pass the confirmed args. Required: `entity`, `claim`, `sourceExcerpt`. Optional: `sourceRef`, `metricKey`, `metricValue`, `metricUnit`, `workspace`.

### Step 5 — Quote the signed response back verbatim

The `canon_write` tool returns a structured response with `factId`, `eventHash`, `parentHash`, status, and a "Verifiable via canon_cite" line. **Surface ALL of these to the user** — they are the cryptographic provenance the user paid for. Do not summarize them away.

Example response to render verbatim:

```
✓ Signed Canon fact

  factId:        f_abc123…
  eventHash:     8f3e2a1d…
  chained onto:  4b9c7e8f…
  status:        active

Verifiable via canon_cite({factId: "f_abc123…"}) — returns the full COSE_Sign1
envelope for offline Ed25519 verification.
```

### Step 6 — Handle redaction

If the response shows `status: redacted`, surface the warning prominently:

```
⚠ The local PII/secret scanner caught a sensitive pattern in your claim or excerpt.
The fact was signed but stored as <redacted> — the signature chain is intact, but
the content is not retrievable. If this was a false positive, write a fresh claim
without the trigger pattern (often: AWS keys, JWTs, email+password combos).
```

## Anti-patterns

- ❌ **Don't sign without showing the preview first.** The whole point of this skill is human-in-the-loop. Auto-signing defeats the trust model.
- ❌ **Don't summarize away the cryptographic response.** factId + eventHash are the trust signal — the user will paste them into canon_cite later.
- ❌ **Don't invent a sourceExcerpt.** If the user has nothing, reuse the claim and flag it. Never fabricate source text.
- ❌ **Don't batch multiple writes through one preview.** Each fact gets its own preview + confirm + sign cycle.

## Pitch beat this enables

User in terminal: *"Log a fact: Miller Group migrated to annual billing on April 20th."*
Claude renders preview → user types `y` → signed FactEvent appears in chain → user opens canon.ultranova.io and the new fact is there with brand-coded "manual" source.

Same code path as Slack/Gmail/PDF ingestion. Same Ed25519 signature. Same hash chain.
