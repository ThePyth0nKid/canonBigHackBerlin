# Canon — Stage Cue Sheet

**For Nelson on stage. One page. Tape this to your laptop lid.**

90 s total. Track: Qontext. Pitcher: Nelson Mehlis.

---

## Pre-stage checklist (T-5 min)

- [ ] `/Users/nelsonmehlis/Desktop/canon` — `npm run dev` running on :3000
- [ ] Browser tab 1: `http://localhost:3000/app` — already logged in, sync NOT yet clicked (so demo can show fresh sync)
- [ ] Browser tab 2: Canon proof modal pre-loaded on €127k fact (backup)
- [ ] Cursor / Claude Desktop open with `canon-mcp` server connected; tools listed
- [ ] Pre-recorded fallback at `/Users/nelsonmehlis/Desktop/canon/demo/fallback.mp4` queued in QuickTime (ready to fullscreen on Cmd-Tab)
- [ ] Phone in airplane mode. Laptop on AC.
- [ ] Glass of water on stage table.

---

## Cue sheet

| Time   | Slide | Stage action                                           | If it breaks                                  |
|--------|-------|--------------------------------------------------------|-----------------------------------------------|
| 0:00   | 1     | Slide on screen. Hold silence after question.          | —                                             |
| 0:12   | 2     | Click to slide 2. No app interaction.                  | —                                             |
| 0:25   | 3     | Slide 3. Point at each layer as you name the partner.  | —                                             |
| 0:40   | 4     | Switch to `/app`. Click **Sync now**.                  | If sync >5 s, keep talking, don't wait silent.|
| 0:48   | 4     | Wait for fact list. Open €127k vs €150k conflict.      | If conflict UI fails: open pre-loaded tab 2.  |
| 0:55   | 4     | Click **Pick €127,000**. Toast confirms signed event.  | If pick fails: say "and the pick is signed", continue. |
| 1:00   | 4     | Cmd-Tab to Cursor. Show `canon.lookup("northwind")` result with citation. | If MCP fails: "and the MCP-call goes here" → next slide. |
| 1:10   | 5     | Slide 5. Optional: Cmd-Tab back to /app, "View proof". | Skip click if behind.                         |
| 1:25   | 6     | Slide 6. Eye contact with Qontext jurors.              | —                                             |
| 1:38   | 7     | Slide 7. Land the one-sentence pitch. Stop talking.    | —                                             |
| 1:40   | —     | "Danke." Don't fill the silence.                       | —                                             |

---

## Total-fail fallback (demo dies completely)

1. Cmd-Tab to QuickTime full-screen → `fallback.mp4` (90 s screencast recorded Saturday evening).
2. Speak over the video using Slide 4–5 speaker notes.
3. Skip directly to slide 6, 7. Land the close.

**Fallback path:** `/Users/nelsonmehlis/Desktop/canon/demo/fallback.mp4`
**If even that fails:** stay on slide 4 with the 5 beats text, narrate what *would* happen, move on. Do **not** apologize twice.

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
| ACME seats (final)         | **50**        |
| ACME seats (superseded)    | 40            |
| ACME renewal               | 2026-05-15    |
| ACME ACV                   | €120,000      |
| TechCo MRR lost            | €2,400        |
| Q2 pipeline (weighted)     | €444,000      |

If you blank: say "the Q1 number" not a wrong number.

---

## After the pitch

- Don't pack up. Stay for Q&A on stage.
- After Q&A: walk to Qontext booth. Drop the `claude-desktop-config.example.json` line: "Mount this in your stack — should take 5 minutes."
- HV Capital judge: hand business card if asked. Don't volunteer it.
