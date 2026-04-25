# Slide 4 — Live Demo

**Title:** Live demo

## On screen (≤60 words)

**Live demo — 5 beats:**

1. Click `Sync` → 3 sources read, ~50 facts signed
2. Q1 MRR **€127k** — `✓ 2 sources` corroborated
3. ACME seats **conflict: 50 vs 40** → user picks → `Sign as canonical`
4. `view proof` → COSE_Sign1 hex + ✓ verified · ~12ms
5. Cursor: ask Claude → `canon_lookup("acme")` → cited facts

## Speaker notes (~22s, ~58 words)

"Ich klick Sync. Canon liest Slack, Gmail, das Board-PDF — über fünfzig Facts signiert in unter zehn Sekunden. Hier — Q1 MRR hundertsiebenundzwanzigtausend, von zwei Quellen bestätigt. Hier — ACME-Seat-Konflikt: fünfzig versus vierzig. Ich pick fünfzig — Canon signiert die Entscheidung als Resolution-Event. View Proof — die volle COSE-Sign1-Hex-Envelope. Verify — verified, zwölf Millisekunden. Und im Cursor-Fenster: derselbe Agent, ohne dass ich erkläre wer ACME ist, ruft Canon-MCP autonom an."

## Stage cue

- **T-2 min pre-warm:** in Claude Code session, fire `canon_lookup({entity:"northwind"})` once. Avoids 5-15s npx-tsx cold-start mid-pitch.
- **T-30 sek:** confirm `/app` shows the ⚠ Resolve conflict button on ACME seats. If auto-resolved (no badge), pick a different conflict (Globex, Soylent) live.
- **Switch to `/app` workspace at start.** Click "Sync now". Toast in 8-12s shows the count.
- Click `⚠ Resolve conflict →` on **ACME · seats**.
- Side-by-side modal opens. Click **Sign as canonical** on the **50** column. Modal closes, page refreshes.
- Click `view proof →` on Q1 MRR €127k. Modal opens with vault aesthetic. Click **Verify signature**. Wait for ✓ verified · Xms.
- Cmd-Tab to Cursor / Claude Code. Type: **"Was wissen wir über ACME mit kryptographischem Beweis?"**. Wait for `canon_lookup` + `canon_cite` calls.
- **If demo fails at any beat:** see `pitch/STAGE-CUES.md` failure scripts. Final fallback: `demo/fallback.mp4` (record Sa abends).

## Demo-state expectation (rehearse against this)

After Sync (`/api/sync?audit=off` ~8s):
- ~50 active signed facts, ~5 superseded
- 5 corroborations (incl. **northwind.mrr=€127,000**, **techco.churn=€2,400**, **techco.seats=12**, **northwind.pipeline=€444k**)
- 5 live conflicts (incl. **acme.seats: 50 vs 40 vs 30 vs 10**, **globex.seats: 25 vs 22 vs 180 vs 3**, **soylent.seats: 14 vs 12** — but soylent auto-resolves to 14)
- 6 customer entities visible: northwind, acme, techco, globex, initech, soylent
