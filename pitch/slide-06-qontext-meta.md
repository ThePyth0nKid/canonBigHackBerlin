# Slide 6 — Qontext meta · we ate your dogfood

**Title:** Wir konkurrieren nicht. Wir feeden.

## On screen (≤80 words)

**Canon konkurriert nicht mit Qontext. Wir feeden sie. Mit ihren eigenen Daten.**

```
   Canon (signed-fact-source, Layer 1)
              │
              ▼  MCP · 6 tools
   ┌──────────────────────┐
   │  Qontext stack       │  ← mounts canon-mcp
   │  (context layer)     │     in 5 minutes
   └──────────────────────┘
              │
              ▼
        Customer agents
```

- **RAG** halluziniert by similarity. **Canon** proves provenance.
- **We ingested Qontext's enterprise dataset.** 310 facts signed. 6 industry conflicts surfaced **straight from your clients.json** (Miller Group, Gonzalez Inc, Johnson Group, Huang LLC, Williams Group, Martin Ltd). 40 PII redactions caught by Layer 3 in your contact_email fields. Per-workspace hash chain.
- Recursive trust: Aikido scant Canons eigenen Code. **3 gefunden, 3 triaged, HIGH gefixt.**

## Speaker notes (~22s, ~58 words)

"Der Punkt für Qontext: wir konkurrieren nicht — wir feeden. Mit eurem eigenen Dataset. Wir haben gestern Abend euer Inazuma-Dataset durch Canon gepumpt. Dreihundertzehn Facts signiert. Sechs industry-Konflikte aus euren clients-json — Miller Group ist gleichzeitig Entertainment und Manufacturing in eurem File, nicht in unserem. Vierzig PII-redactions in den contact-emails von Layer drei gefangen. Same pipeline, anderer workspace. Mount canon-MCP in eurem Stack — fünf Minuten. RAG halluziniert. Canon proves provenance."

## Stage cue

- Click `/app?ws=inazuma` switcher (~3s pause) so the audience sees the workspace badge update from `northwind 50` to `inazuma 310`.
- Point at `miller_group` in the demo-gold list. Don't click into it — that beat is on Slide 4 if there's room.
- Eye contact with Qontext jurors (Hieber/Kowalski) at "wir feeden sie."
- This is the dinner-winning slide.

## Why this lands

The Qontext brief explicitly anti-targets "dumping markdown into folders" and "documentation chatbot," and rewards "generalize beyond the provided dataset" PLUS "preserve provenance at the fact level." Canon does both:
- **Generalises**: same code, same FactDraft contract, two workspaces.
- **Provenance**: every Inazuma fact carries `qontext:client:{client_id}` or `qontext:vendor:{client_id}` sourceRef, hash-chained, COSE-signed.
- **Auto-resolve / escalate**: dominates-policy auto-resolves obvious cases; the 6 Miller-class conflicts surface for user-pick.

The 40 PII redactions are the unexpected demo gold: Layer 3's local pattern engine caught real-shaped emails in the contact_email column without us touching a config. That's "we read your data correctly" as a behavior, not a slide claim.
