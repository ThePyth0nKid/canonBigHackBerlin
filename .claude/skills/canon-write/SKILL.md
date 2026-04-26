---
name: canon-write
description: Use this skill whenever the user wants to add, write, log, record, or sign a new fact into the Canon ledger from the terminal — phrases like "add a fact to canon", "write to canon", "log this in canon", "record this", "sign this fact", "/canon-write", or any time the user mentions creating a new signed truth in Canon. Walks the user through entity/claim/source preview-and-confirm BEFORE signing. Uses AskUserQuestion for the confirm step (real UI buttons, no text typing). Never auto-signs.
---

# /canon-write — sign a new Canon fact (preview → click → sign)

Capability layer: `canon_write` MCP tool (one draft through the shared scan→sign→persist pipeline).
This skill: human-in-the-loop terminal UX with `AskUserQuestion` for the confirm step.

## When to invoke

User says any of: "add a fact", "write to canon", "log this", "record this in canon",
"sign this", "create a canon fact", "/canon-write", or describes a one-line factual
claim they want persisted with cryptographic provenance.

## Workflow

### Step 1 — Capture the four required fields

If the user already gave them in their message, use those. Otherwise ask in one round (free-form, in chat):

- **`entity`** (slug, lowercase snake_case, e.g. `miller_group`, `gonzalez_inc`) — required
- **`claim`** (one full sentence in natural language) — required
- **`sourceExcerpt`** (1–2 lines of original text the claim is grounded in) — required.
  If the user truly has no source text, suggest reusing the claim itself, but flag it as "source = self-attested".
- **`sourceRef`** (optional; defaults to `manual:agent-claude:<ISO>`) — only ask if the user mentioned a stable external pointer
- Optional structured metric: `metricKey` + `metricValue` + `metricUnit` if the claim contains a number worth comparing for conflicts later (price, seat count, date)

Don't pepper the user with one-question-at-a-time. Ask everything missing at once with a numbered list in chat.

### Step 2 — Render the preview block

Show what's about to be signed (markdown block, scannable):

```
About to sign this Canon fact:

  entity:         <entity>
  claim:          "<claim>"
  sourceRef:      <sourceRef>
  sourceExcerpt:  "<excerpt>"
  workspace:      inazuma   (default)
  [metric:        <key> = <value> <unit>]   (only if provided)
```

### Step 3 — Use `AskUserQuestion` for the confirm

This is the click-instead-of-typing step. ONE question:

```
question: "Sign this Canon fact to the chain?"
header:   "Sign?"
multiSelect: false
options: [
  { label: "Sign as canonical",         description: "Pipes through scan→sign→persist. Returns a signed FactEvent at the chain tip." },
  { label: "Edit a field first",        description: "Cancel this preview, ask which field to change, re-render, ask again." },
  { label: "Cancel — don't sign",       description: "Discard the preview. No DB write." },
]
```

### Step 4 — Dispatch based on answer

- **"Sign as canonical"** → call `canon_write` with the args from Step 1.
- **"Edit a field first"** → in chat, ask "Which field would you like to change?" → update → go back to Step 2.
- **"Cancel"** → confirm cancellation in chat. No tool call.
- **"Other"** (free text): interpret literally — "yes/y/sign" → sign, "no/cancel" → cancel, "edit X to Y" → update field X to Y and re-render.

### Step 5 — Quote the signed response back verbatim

The `canon_write` tool returns a structured response with `factId`, `eventHash`, `parentHash`, status, and a "Verifiable via canon_cite" line. **Surface ALL of these to the user** — they are the cryptographic provenance. Do not summarize them away.

Example:

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

- ❌ **Don't sign without showing the preview + getting an explicit click first.** The whole point of this skill is human-in-the-loop. Auto-signing defeats the trust model.
- ❌ **Don't summarize away the cryptographic response.** factId + eventHash are the trust signal.
- ❌ **Don't invent a sourceExcerpt.** If the user has nothing, reuse the claim and flag it as "self-attested".
- ❌ **Don't batch multiple writes through one preview.** Each fact gets its own preview + click + sign cycle.

## Pitch beat this enables

User: *"Log a fact: Miller Group migrated to annual billing on April 20."*
Claude renders preview → AskUserQuestion shows three buttons (Sign / Edit / Cancel) → user clicks "Sign as canonical" → signed FactEvent appears in chain → user opens canon.ultranova.io and the new fact is there with brand-coded "manual" source.

Same code path as Slack/Gmail/PDF ingestion. Same Ed25519 signature. Same hash chain.
