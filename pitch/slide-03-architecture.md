# Slide 3 — Architecture

**Title:** Trust Pipeline — vier Layer, kein Sticker

## On screen (≤60 words)

```
Slack/Gmail/PDF Source
      │
      ▼
┌─────────────────────────────┐
│ 1. Pioneer / Fastino        │  deterministic structured extract
│    (typed schema)           │  → reproducible fact draft
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│ 2. Gemini 2M-context        │  reads full channel history as critic
│    long-context auditor     │  → flag if fact contradicts wider context
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│ 3. Aikido write-time scan   │  PII/secrets in fact body?
│                             │  → refuse-to-sign, emit RedactionEvent
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│ 4. Conflict-Resolution      │  source-precedence (CRM > email > Slack)
│    via SIGNED POLICY        │  + recency-wins + human-pick
│    (NOT web search!)        │  → every resolution is itself a signed event
└─────────────────────────────┘
      │
      ▼
   Ed25519 + COSE_Sign1 + hash-chain → MCP-Server → Qontext mounts
```

*Keine banalen Sticker — jeder Layer verändert die Wahrheit.*

## Speaker notes (≤90 words, ~15s)

"Vier Layer. Pioneer, von Fastino Labs, extrahiert deterministisch — gleicher Input, gleicher Hash. Gemini, mit Two-Million-Context, liest die volle Kanal-History und flagt Widersprüche. Aikido scannt write-time auf PII und Secrets — Canon refuses to canonize secrets. Conflict-Resolution via signierter Policy: Recency, Source-Precedence, oder User-Pick. Ende: Ed25519, COSE-Sign1, hash-chained. Keine Sticker. Jeder Layer verändert, was als Wahrheit signiert wird."

## Stage cue

Hold this slide longer (~15s). Point at each box as you name the partner. No clicks.
