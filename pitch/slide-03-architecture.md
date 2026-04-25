# Slide 3 — Architecture

**Title:** Trust Pipeline — fünf Layer, drei eligible partner

## On screen (≤80 words)

```
Slack / Gmail / PDF / Qontext-dataset / …
      │
      ▼
┌─────────────────────────────┐
│ 1. Pioneer / Fastino        │  ✓ partner   deterministic span extraction
│    GLiNER-2 (typed schema)  │              same input → same hash
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐  ┌────────────────────────┐
│ 2. Gemini 2.5-flash         │  │ 2.5  Tavily            │ ✓ partner
│    long-context auditor     │  │      external context  │
│    fail-closed on error     │  │      ⚠ unsigned tag    │
└─────────────────────────────┘  └────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│ 3. Aikido + local scan      │  recursive trust:
│    secret/PII refuse        │  Canon's own repo
│    → RedactionEvent         │  is monitored
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│ 4. canon-signer (Rust)      │  Ed25519 + COSE_Sign1
│    per-workspace hash chain │  separate canon-verify binary
└─────────────────────────────┘
      │
      ▼
   MCP server (6 tools) → any agent · Qontext-mountable
```

**Eligible partner technologies (BBH submission rule):** Pioneer + Gemini + Tavily.
Aikido is an additional Layer-3 trust contribution.

## Speaker notes (~16s, ~42 words)

"Fünf Layer, drei eligible partner. Pioneer extrahiert deterministisch — gleicher Input, gleicher Hash. Gemini, two-point-five-flash mit hundertzwanzigtausend Token Context, audited die Quelle. Tavily liefert public-web Kontext — explizit als unsigned getaggt, nie verwechselbar mit Canons signierten Facts. Aikido scant Canons eigenen Code, dazu lokale Pattern-Engine für Customer-PII. Canon-Signer signiert: Ed25519, COSE-Sign-One, hash-chained pro workspace. Keine banalen Sticker. Jeder Layer verändert, was als Wahrheit signiert wird."

## Stage cue

Hold this slide longer (~15s). Point at each box as you name the partner. The Tavily box on the right gets a one-second pause — the "unsigned tag" line is the architectural hinge. No clicks.

## Why this matters for the BBH submission

The official rule (manual §"Partner Technology eligibility for the ≥3 partners rule") requires three technologies from {Google DeepMind, Tavily, Lovable, Gradium, Pioneer/Fastino}. Aikido and Entire don't count toward the three. Canon ships **Pioneer + Gemini + Tavily = 3 eligible partners**, plus Aikido as an additional trust-pipeline contribution. That's compliant with bonus surface for Aikido side-challenge separately.
