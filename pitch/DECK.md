# Canon — Pitch Deck

**Big Berlin Hack 2026 · Track: Qontext (Context Layer for AI) · 90 seconds**

Pitcher: Nelson Mehlis · github.com/ThePyth0nKid/canonBigHackBerlin

---

## Timing table

| Slide | Title                                  | Speaker time | Cumulative |
|-------|----------------------------------------|--------------|------------|
| 1     | Hook                                   | ~12 s        | 0:12       |
| 2     | Solution                               | ~13 s        | 0:25       |
| 3     | Architecture (Trust Pipeline)          | ~15 s        | 0:40       |
| 4     | Live demo                              | ~20 s        | 1:00       |
| 5     | Technical depth (proof)                | ~13 s        | 1:13       |
| 6     | Qontext meta                           | ~13 s        | 1:26       |
| 7     | Open source + the ask                  | ~14 s        | 1:40       |

Budget 90 s. Above sums to ~100 s — trim slide 4 demo if running long (skip the proof modal click). At 150 wpm, 90 s = ~225 words. Speaker-notes total ~210 words; demo dwell-time eats the rest.

**Hard cutoffs:**
- If sync takes >5 s on slide 4 → keep talking, don't wait silently.
- If Cursor MCP call fails → say "and the MCP-call goes here" and move on.
- Always finish on slide 7 one-sentence pitch — never skip it.

---

# Slide 1 — Hook

**Title:** Wo ist die Wahrheit?

## On screen

> **Du bist CFO. Morgen Board.**
> **Wo ist die Wahrheit?**

```
   Slack   |   Gmail   |   Drive
       \   |   /
        \  |  /
         ? ? ?
   "Was war unser Q1 MRR?"
```

Dein Agent rät. Oder halluziniert. Oder schweigt.

## Speaker

"Stell dir vor: du bist CFO. Morgen Board Review. Deine Firmen-Facts liegen in Slack, in Gmail, in einem Board-Deck-PDF. Du fragst deinen AI-Agent: was war unser Q1 MRR? Und der rät. Oder halluziniert. Oder zeigt dir 'I don't know'. Das ist kein Prompt-Problem. Das ist ein Infrastructure-Problem."

## Stage cue
Open with deck slide on screen. Hold the silence after "Wo ist die Wahrheit?" for one beat. No clicks yet.

---

# Slide 2 — Solution

**Title:** Canon. One file. Every source. Every agent.

## On screen

**Canon — der signierte Fakten-Ledger für AI-Agents.**

```
┌─────────────────┬─────────────────┐
│  MCP-native     │  Ed25519-signed │
├─────────────────┼─────────────────┤
│  Hash-chained   │   MIT, OSS      │
└─────────────────┴─────────────────┘
```

Sources schreiben rein. Agents lesen raus. Jeder Fakt mit Quelle, Signatur und Audit-Chain.

## Speaker

"Canon. One file. Every source. Every agent. Canon ist ein cryptographically-signed Fakten-Ledger. Sources schreiben rein — Slack, Gmail, PDFs. Agents lesen raus — via MCP, native, fünf Tools, dreißig Zeilen Config. Jeder Fakt ist Ed25519-signiert, hash-chained an den vorherigen, und mit Quelle belegt. Open-source, MIT, ab Tag eins."

## Stage cue
Switch from hook slide to homepage-style 4-pillar grid.

---

# Slide 3 — Architecture (Trust Pipeline)

**Title:** Trust Pipeline — vier Layer, kein Sticker

## On screen

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

## Speaker

"Vier Layer. Pioneer, von Fastino Labs, extrahiert deterministisch — gleicher Input, gleicher Hash. Gemini, mit Two-Million-Context, liest die volle Kanal-History und flagt Widersprüche. Aikido scannt write-time auf PII und Secrets — Canon refuses to canonize secrets. Conflict-Resolution via signierter Policy: Recency, Source-Precedence, oder User-Pick. Ende: Ed25519, COSE-Sign1, hash-chained. Keine Sticker. Jeder Layer verändert, was als Wahrheit signiert wird."

## Stage cue
Hold this slide longer (~15 s). Point at each box as you name the partner.

---

# Slide 4 — Live demo

**Title:** Live demo

## On screen

**Live demo — 5 beats:**

1. Click `Sync` → 3 sources read
2. **12 facts** extracted, signed
3. Conflict surfaces: **€127k vs €150k**
4. User pick → ResolutionEvent signed
5. MCP call: Claude reads Canon, cites €127k

## Speaker

"Ich klicke Sync. Canon liest aus Slack, Gmail, dem Board-PDF. Zwölf Facts extrahiert. Hier — Q1 MRR: hundertsiebenundzwanzigtausend, bestätigt durch drei Quellen. Hier — der Conflict: hundertfünfzig Forecast versus hundertsiebenundzwanzig Actual. Ich pick die Wahrheit. Canon signiert die Entscheidung selbst. Und jetzt, im Cursor-Terminal: MCP-Call an Canon — der Agent liest die signierten Facts mit Citation. Eine Quelle, jeder Agent, kryptographisch beweisbar."

## Stage cue
- Switch to `/app` workspace at start.
- Click "Sync now". Wait for fact list to populate.
- Open the €127k vs €150k conflict modal.
- Click "Pick €127,000".
- Switch to Cursor / Claude Desktop terminal showing MCP call to `canon.lookup("northwind")`.
- **Fallback:** flip to pre-recorded screencast at `/Users/nelsonmehlis/Desktop/canon/demo/fallback.mp4`.

---

# Slide 5 — Technical depth (proof)

**Title:** Tamper-proof. Offline-checkable.

## On screen

```
COSE_Sign1 envelope (hex):
  d28443a10127a0586b...8eb2a4f1c3...

Ed25519 pubkey (kid):
  3f9c4e2a...d7b1

$ canon-verify event.cose
  { verified: true,
    eventHash: "9b1f...",
    parentHash: "8a0e...",
    kid:        "3f9c4e2a...",
    signedAt:   "2026-04-25T13:42Z" }
```

- Different binary verifies — independent of Canon
- Offline-checkable — no network, pinned pubkey
- Tamper-proof — break the chain, verify fails
- Any agent can pin the pubkey and read facts directly

## Speaker

"Für die, die's genau wissen wollen. Jeder Fact ist ein COSE-Sign1-Envelope, Ed25519-signiert, hash-chained an den parent. Canon-verify ist eine separate Binary — anderes Repo, andere Sprache, kein Trust in Canon nötig. Du pinnst den Pubkey, du verifizierst offline. Brichst du die Chain, fällt der Verify. Jeder Agent kann das. Das ist nicht 'AI rät' — das ist provable provenance."

## Stage cue
Optional click into "View proof" modal in /app to show the actual hex envelope live.

---

# Slide 6 — Qontext meta

**Title:** Wir konkurrieren nicht. Wir feeden.

## On screen

**Canon konkurriert nicht mit Qontext. Wir feeden sie.**

```
   Canon (signed-fact-source, Layer 1)
              │
              ▼  MCP
   ┌──────────────────────┐
   │  Qontext stack       │  ← mounts canon-mcp
   │  (context layer)     │     in 5 minutes
   └──────────────────────┘
              │
              ▼
        Customer agents
```

- **RAG** halluziniert by similarity.
- **Canon** proves provenance.
- Recursive trust: Canon's own repo is Aikido-monitored — 0 issues, signed banner live.

## Speaker

"Der Punkt für Qontext: wir konkurrieren nicht — wir feeden. Canon ist die signed-fact-source, Layer eins. Qontext ist der Context-Layer drüber. Mount Canon-MCP in fünf Minuten in Qontext, und Qontext serviert plötzlich kryptographisch beweisbare Facts an seinen Customer-Stack. RAG halluziniert by similarity — Canon proves provenance. Und ja: Canons eigenes Repo ist Aikido-monitored, null Issues, signiert. Recursive trust."

## Stage cue
Eye contact with Qontext jurors (Hieber/Kowalski) if visible. This is the dinner-winning slide.

---

# Slide 7 — Open source + the ask

**Title:** MIT. MCP-native. Design partners.

## On screen

**github.com/ThePyth0nKid/canonBigHackBerlin** — MIT

- 5 MCP tools: `lookup` · `search` · `cite` · `diff` · `write`
- 3 source adapters live: Slack · Gmail · PDF
- Self-host: `docker-compose up`

**Was wir suchen:** Design partners. Teams mit AI-Agents, die heute halluzinieren, weil sie keine Source of Truth teilen.

> Canon ist ein signierter Fakten-Ledger für AI-Agents: du füllst ihn aus Slack/Gmail/Docs, Agents lesen ihn statt deiner Rohdaten, und jeder Fakt ist kryptographisch beweisbar.

## Speaker

"Canon ist MIT, ab Tag eins. Fünf MCP-Tools. Drei Source-Adapter live, zehn weitere als Issues im Repo. Was wir suchen: Design Partners. Teams, deren AI-Agents heute halluzinieren, weil sie keine Source of Truth teilen. Ein Satz: Canon ist ein signierter Fakten-Ledger für AI-Agents — du füllst ihn aus Slack, Gmail, Docs; Agents lesen ihn statt deiner Rohdaten; jeder Fakt ist kryptographisch beweisbar. Danke."

## Stage cue
Hold final slide. Make eye contact with HV Capital + the founder panel. Don't fill silence — let the one-sentence land.
