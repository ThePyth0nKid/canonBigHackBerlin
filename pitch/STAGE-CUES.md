# Canon — Stage Cue Sheet

**For Nelson on stage. One page. Tape this to your laptop lid.**

90 s total. Track: Qontext. Pitcher: Nelson Mehlis.

---

## Pre-stage checklist (T-5 min)

- [ ] `/Users/nelsonmehlis/Desktop/canon` — `npm run dev` running on :3000
- [ ] Production URL **canon.ultranova.io** is up — quick `curl -I https://canon.ultranova.io/` should return 200. This is the URL jurors can type into their phone live during the pitch.
- [ ] **T-3 min: rehearse one full Sync** so the DB has fresh facts, then leave it. /app shows ~50 active facts.
- [ ] **T-2 min: pre-warm MCP** — in Claude Code, run `Was wissen wir über northwind?` once. Eliminates 5-15s npx-tsx cold start mid-pitch.
- [ ] Confirm `/app` shows ⚠ Resolve conflict on **ACME · seats** (the demo's signature beat). If it auto-resolved → click `Sync now` once more, the next batch usually surfaces it again. Worst case: pick a different conflict (Globex, Soylent).
- [ ] Browser tab 1: `http://localhost:3000/app` — already synced.
- [ ] Browser tab 2: same /app URL as backup (in case tab 1 reloads).
- [ ] Cursor / Claude Code open in `~/Desktop/canon` or `~`; `claude mcp list` shows `canon: ✓ Connected`.
- [ ] Pre-recorded fallback at `/Users/nelsonmehlis/Desktop/canon/demo/fallback.mp4` queued in QuickTime (record Sa abends — see footer).
- [ ] Phone in airplane mode. Laptop on AC. Devtools closed (they leak URLs).
- [ ] Glass of water on stage table.

---

## Cue sheet

| Time   | Slide | Stage action                                           | If it breaks                                  |
|--------|-------|--------------------------------------------------------|-----------------------------------------------|
| 0:00   | 1     | "Two ACMEs" hook. Hold silence after "Two truths."     | —                                             |
| 0:15   | 2     | Click to slide 2. No app interaction.                  | —                                             |
| 0:28   | 3     | Slide 3. Point at each layer as you name the partner.  | —                                             |
| 0:42   | 4     | Switch to `/app`. Click **Sync now**.                  | If sync >8 s, narrate the 4 layers. Don't wait silent. |
| 0:52   | 4     | Click `⚠ Resolve conflict →` on **ACME · seats**.      | If no resolve badge: pick any other ⚠ on screen. |
| 0:58   | 4     | Click **Sign as canonical** on the **50** column.      | If pick fails: say "the pick is itself a signed event", continue. |
| 1:04   | 4     | Click `view proof →` on Q1 MRR €127k. Click **Verify signature**. | If verify shows ✗: skip — say "the binary verifies it offline". |
| 1:12   | 4     | Cmd-Tab to Cursor. Type "Was wissen wir über ACME mit kryptographischem Beweis?" | If MCP cold-start lags: say "watch the routing decision live", point at the canon_lookup call. |
| 1:24   | 5     | Slide 5. Optional: pause on canon_cite output if visible. | Skip click if behind.                         |
| 1:35   | 6     | Slide 6. Eye contact with Qontext jurors.              | —                                             |
| 1:48   | 7     | Slide 7. Pricing line. Land the one-sentence pitch.    | —                                             |
| 1:55   | —     | "Danke." Don't fill the silence.                       | —                                             |

---

## Total-fail fallback (demo dies completely)

1. Cmd-Tab to QuickTime full-screen → `fallback.mp4` (90 s screencast recorded Saturday evening).
2. Speak over the video using Slide 4–5 speaker notes.
3. Skip directly to slide 6, 7. Land the close.

**Fallback path:** `/Users/nelsonmehlis/Desktop/canon/demo/fallback.mp4`
**If even that fails:** stay on slide 4 with the 5 beats text, narrate what *would* happen, move on. Do **not** apologize twice.

---

## Failure scripts (memorize ONE sentence per failure)

| Failure | Sentence | Action |
|---|---|---|
| Sync hangs > 8 s | "Während das läuft — die vier Trust-Layer sind…" | Don't click again. Cmd-Tab to backup tab. |
| Sync HTTP error | "Tab-zwei zeigt den letzten Sync." | Use Tab 2; demo continues at conflict-resolve beat. |
| ⚠ Resolve badge absent | "Diesmal hat Canon den Conflict per Korroboration aufgelöst — schauen wir uns einen anderen an." | Pick any visible ⚠ button (Globex, Soylent). |
| Verify shows ✗ | "Und das Verify-Binary läuft separat — hier offline-checkable." | Close modal; next slide. Don't read the error. |
| MCP cold-start > 10 s | "Schaut auf die Routing-Entscheidung…" | Wait quietly while the canon_lookup tool-call appears. |
| MCP doesn't fire at all | "Und genau diesen Call macht Claude autonom — siehe Slide 6." | Skip to slide 6, the MCP claim is now in the deck not the demo. |
| Browser hangs | (don't apologize) | Cmd-Tab to fallback.mp4, narrate over video. |
| Total demo failure | "Lass mich euch auf der Architektur erklären, was gerade passiert wäre…" | Stay on slide 3, describe each layer's behaviour. Land slide 6, 7. |

---

## Voice / breath cues

- Slide 1: slow. Land "Wo ist die Wahrheit?" as a question. One full beat of silence after.
- Slide 3: technical voice — names of partners crisp.
- Slide 4: live-demo voice — present tense, "ich klicke", "Canon liest".
- Slide 6: this is the dinner slide — slightly slower, eye contact.
- Slide 7: the one-sentence pitch reads at normal pace, no rush. **Then stop.**

---

## Numbers you must NOT mix up

| Fact                       | Value         |
|----------------------------|---------------|
| Q1 MRR (final)             | **€127,000**  |
| Q1 Forecast (superseded)   | €150,000      |
| YoY growth                 | +23%          |
| ACME seats (final)         | **50**        |
| ACME seats (superseded)    | 40            |
| ACME renewal               | 2026-05-15    |
| ACME ACV                   | €120,000      |
| ACME per-seat              | €2,400/year   |
| TechCo MRR lost            | €2,400        |
| TechCo seats churned       | 12            |
| Globex seats               | 25 (final)    |
| Initech seats              | 18 (monthly)  |
| Q2 pipeline (weighted)     | €444,000      |
| Pricing (hosted Canon)     | €0.001/event  |

If you blank: say "the Q1 number" not a wrong number.

---

## After the pitch

- Don't pack up. Stay for Q&A on stage.
- After Q&A: walk to Qontext booth. Drop the `claude-desktop-config.example.json` line: "Mount this in your stack — should take 5 minutes."
- HV Capital judge: hand business card if asked. Don't volunteer it.
