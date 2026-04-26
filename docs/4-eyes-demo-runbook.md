---
type: runbook
name: "4-Augen-Prinzip — Demo-Recording-Runbook"
status: active
created: 2026-04-26
event_day: 2026-04-26
tags: ["#bbh", "#canon", "#runbook", "#demo", "#4-eyes"]
---

# 4-Augen-Prinzip — Demo-Recording Runbook

> **Lesart:** Jede Sektion = eine Aufnahme-Sequenz. URL + Was-Klick-Wo + Was-Sagen + Was-erscheint. Pro Sequenz 30–60s.

## Zwei Varianten — beide aufnehmen, im Schnitt entscheiden

| Variante | Metrik-Beispiel | Was passiert | Demo-Sequenz |
|---|---|---|---|
| **A — Regulärer Pick (KEIN 4-Augen)** | `industry`, `primary_contact`, `tier`, `status` | Click → Confirm → sofort canonical. Eine Person, eine Unterschrift. | **Sequence 1.5** |
| **B — Hoch-Risiko (4-Augen erzwungen)** | `monthly_revenue`, `arr`, `mrr`, `contract_value`, `renewal_date` | Click → Confirm → resolution-PENDING auf Chain → Email an zweiten Admin → Magic-Link → Co-Sign → ATOMIC flip zu canonical | **Sequences 2–6** |

**Pitch-Logik:** Variante A zeigen ZUERST damit das Publikum sieht dass nicht alles im 4-Augen-Loop ist. Dann Variante B als Kontrast: *„Aber für Geld-Felder erzwingt das System automatisch 4-Augen."* Der Kontrast ist die Story.

---

## Pre-Flight (vor Aufnahme)

### Browser-Setup
- **Browser 1 (Initiator):** Privates Fenster, Login-fresh
- **Email-Client offen** (Browser-Tab oder Mac Mail) für `nelson@ultranova.io` Inbox
- **Devtools-Console GESCHLOSSEN** (Audit-Hochpunkte sollen unaufgeregt sein)
- **Browser-Zoom auf 110-125%** damit Pending-Panel und Fight-Cards groß genug fürs Recording sind
- **Dark / Light Mode:** beide funktionieren — Light empfohlen weil Violett-Akzente klarer

### Smoke-Check vor Aufnahme
1. URL: **https://canon.ultranova.io/app**
2. Sollte zu Google-Login führen → einloggen mit `nelson.mehlis@igoultra.de`
3. Nach Login: TopBar oben rechts zeigt **grünen Avatar `N` + „signed in · nelson.mehlis@igoultra.de"**
4. Direkt darunter sollte der Pending-Panel-Slot vorhanden sein (leer wenn keine Pending) — wenn vorhandene Pending da: erstmal aufräumen (siehe „Reset" unten)

### Reset-Falls-Demo-State-Gemüllt-Ist
Wenn die DB schon Pending-Resolutions oder bereits resolved Items hat:
- URL: **https://canon.ultranova.io/decide** zum Überblick
- Manuell entweder einzeln „Decide" klicken um sie aufzuräumen, ODER für saubere Demo ein neuer Sync laufen lassen via SyncButton auf /app

---

## Sequence 1 — Identity-Check (15s)

**URL:** https://canon.ultranova.io/app

**Was zu sehen:**
- Oben rechts: grüner Avatar-Kreis mit `N`, daneben „signed in · nelson.mehlis@igoultra.de"
- Daneben „Sign out" Link

**Mauszeiger:** kreise einmal um den Identity-Badge (top-right)

**Was zu sagen:**
> *"Ich bin als Sales-Manager eingeloggt. Identity ist immer sichtbar — kein Versteckspiel."*

---

## Sequence 1.5 — KONTRAST: Regulärer Pick OHNE 4-Augen (45s)

> **Warum diese Sequenz wichtig ist:** Der 4-Augen-Beat ist nur stark wenn das Publikum vorher gesehen hat dass NICHT alle Picks 4-Augen brauchen. Diese Sequenz zeigt den schnellen Pfad: nicht-Geld-Felder = ein Klick + Confirm = sofort canonical. Das macht den Kontrast zu Sequence 3 (4-eyes für Revenue) sichtbar.

**URL:** https://canon.ultranova.io/app

**Was zu klicken:** AskCanon-Eingabefeld

**Eingabe (low-risk Konflikt — kein 4-Augen-Trigger):**
```
Welche Konflikte gibt es bei Johnson Group?
```
Alternative wenn das nicht klappt:
```
Was ist der Konflikt bei Gonzalez Inc primary_contact?
```

Click „**Ask →**"

**Was erscheint nach ~2s:**
- Decision-required Header
- Fight-Card mit:
  - Header: `Johnson_group · industry` (oder `Gonzalez_inc · primary_contact`)
  - **KEIN violet 4-eyes Badge** rechts oben — weil "industry" / "primary_contact" weder revenue/contract/etc matchen
  - Zwei oder mehr Werte zur Auswahl

**Mauszeiger:** zeige zur Stelle WO der Badge bei Sequence 3 sein wird (rechts oben in der Card-Header). Hier ist NIX. Das ist die Pointe.

**Was zu sagen:**
> *"Hier ein normaler Konflikt — Industry oder Primary Contact von einem Kunden. Nicht-Geld, niedriges Risiko. Kein 4-Augen-Badge. Schauen Sie genau dahin oben rechts — leer."*

**Click „Sign as canonical"** auf einem der Werte (z.B. dem mit der frischeren Quelle)

→ **Roter Confirm-Strip** erscheint (gleiche L1-Confirmation wie überall) mit anderem Text:
```
⚠ This becomes Source of Truth for Johnson Group · industry. 1 other candidate flips to superseded.
[ wait... ] [ Cancel ]
```

**Was zu sagen während des 1.5s Cooldowns:**
> *"Auch hier — Confirm vor jedem Sign. Aber für niedriges Risiko reicht eine Unterschrift."*

**Click „Confirm · sign canonical"** wenn der Button verfügbar ist

**Was passiert (~1s):**
- Card wird grün-bordered, „canonical"-Badge auf dem Winner
- **GRÜNER Footer:** „signed · canonical · 1 superseded · resolution f_res_xxx..."
- KEIN Pending-Footer, KEIN Cosign-Wait

**Was zu sagen:**
> *"Eins fertig. Direkt signed canonical. Eine Person, eine Unterschrift, sofort gültig für jeden Agent im Workspace."*

**Pivot zur 4-Augen-Sequenz:** *„Aber jetzt schauen Sie was passiert wenn ich nach REVENUE frage…"*

---

## Sequence 2 — High-Risk-Konflikt finden (20s)

**URL:** https://canon.ultranova.io/app (gleiche Seite)

**Was zu klicken:** Mauszeiger in das **Ask Canon** Eingabefeld (lila Box, oben unter dem H1)

**Eingabe:** Tippe (oder paste):
```
Was ist der Konflikt bei Gonzalez Inc monthly_revenue?
```

Click „**Ask →**" (lila Button rechts) oder Enter

**Was erscheint nach ~2s:**
- Decision-required Header: „Decision required · 1 conflict in your ledger"
- Eine Fight-Card mit:
  - Header: `Gonzalez_inc · monthly_revenue`
  - **VIOLET BADGE rechts oben: `👁️👁️ 4-eyes required`** ← das ist der Money-Shot
  - Zwei Werte: $351,143 und $4,305,773 mit Source-Tags

**Mauszeiger:** zeige zum **violet 4-eyes Badge** und kreise

**Was zu sagen:**
> *"Sobald es um Geld geht — Revenue, ARR, MRR, Contract-Value — gilt automatisch das 4-Augen-Prinzip. Das System hat das selbst erkannt: 'monthly_revenue' fällt unter Hoch-Risiko. Ein einzelner Klick reicht nicht."*

---

## Sequence 3 — Pick als Pending signieren (25s)

**Auf der gleichen Seite, gleiche Card.**

**Was zu klicken:** Mauszeiger zum **„Sign as canonical"** Button (schwarz/weiß, rechts neben dem `$4,305,773` Wert — der größere, plausiblere Wert)

**1. Click** → Button morpht in **roten Confirm-Strip**:
```
⚠ 4-eyes metric. Your pick is signed as resolution-PENDING;
1 other candidate stays active until a SECOND admin co-signs
[ wait... ] [ Cancel ]
```

**Was zu sagen während des 1.5s Cooldowns:**
> *"Erstmal Confirm — bewusste Bestätigung dass das jetzt Source of Truth wird. 1.5 Sekunden Wartezeit gegen Reflex-Klicks."*

**Wenn Button von „wait…" zu „Confirm · sign canonical" wechselt:**

**2. Click „Confirm · sign canonical"**

**Was passiert (~1s):**
- Button zeigt „signing…"
- Dann erscheint **violet Footer unten in der Card:**
```
👁️👁️ awaiting 4-eyes co-sign
Pick is signed as resolution-PENDING (f_res_xyz...).
Losers stay active; supersedure applies only after a SECOND admin co-signs.
[ co-sign · sign as canonical ]
```
- Card-Border wird violett

**Was zu sagen:**
> *"Mein Vorschlag ist jetzt SCHON SIGNIERT auf der Hash-Chain. Aber die alten Werte sind noch active — nichts wurde überschrieben. Der Eintrag wartet auf eine zweite Unterschrift."*

---

## Sequence 4 — Pending-Panel zeigen (15s)

**Wichtig:** scroll up zum Seitenanfang, ODER Page-Reload (F5).

**URL:** gleiche, `https://canon.ultranova.io/app`

**Was erscheint OBEN über AskCanon (war vorher leer):**
```
👁️👁️ 1 resolution awaiting 4-eyes co-sign     high-risk · pending on chain

  [VIOLET CARD]
  Gonzalez_inc · monthly_revenue
  $4,305,773
  Proposed by nelson.mehlis@igoultra.de [you]  ·  2s ago
  1 fact will flip to superseded once co-signed · pending event f_res_xxx...

  [ awaiting different admin ]   ← grauer Disabled-Tag
```

**Mauszeiger:** zeige zum **„awaiting different admin"** Tag (grau, rechts in der Card)

**Was zu sagen:**
> *"Hier oben hat Canon ein neues Tracking-Panel. Jede pending Resolution ist gelistet — auch wenn ich die Seite neulade, refresh, abmelde. Das System wartet auf den zweiten Admin. Mich selbst lässt es nicht ko-signieren — der Tag sagt 'awaiting different admin'."*

---

## Sequence 5 — Email + Magic-Link (30s)

**URL Tab-Switch:** zur Email-Inbox

**Was zu zeigen:**
- Neue Email: Subject `[for nelson@ultranova.io] 4-eyes co-sign needed: Gonzalez Inc · monthly_revenue = $4,305,773`
- Email-Body mit:
  - Lila Banner: `4-eyes co-sign request · For nelson@ultranova.io`
  - Headline: „A high-risk pick needs your second signature"
  - Box mit dem proposed value
  - Lila Button: **„Review & co-sign on Canon →"**

**Mauszeiger:** zeige Subject, scroll durch Email-Body, ende auf dem lila Button

**Was zu sagen:**
> *"Das System mailt automatisch jeden Admin der nicht der Initiator ist. Hier landet der Co-Sign-Request bei nelson@ultranova.io. Selbe Architektur die Canon schon für Customer-Decisions nutzt — eine Pipeline, zwei Use-Cases."*

**Click:** auf den **„Review & co-sign on Canon →"** Button

**Was passiert:**
- Browser navigiert zu `https://canon.ultranova.io/app/cosign?res=…&as=…&exp=…&sig=…`
- 302 Redirect → URL wird clean: `https://canon.ultranova.io/app#pending-f_res_xxx`
- Cookie `canon_cosign` ist gesetzt (httpOnly, sichtbar in Devtools wenn auf gefragt)

---

## Sequence 6 — Co-Sign ausführen (30s)

**URL:** `https://canon.ultranova.io/app#pending-…` (von Magic-Link weitergeleitet)

**Was zu sehen:**
- Pending-Panel oben — die Row hat jetzt einen **violet ring drumrum** (Highlight weil Cookie matched)
- Der **„awaiting different admin" Tag ist WEG**, stattdessen ist da ein **lila Button: „co-sign · admin"**

**Mauszeiger:** zum **„co-sign · admin"** Button

**Was zu sagen:**
> *"Andere Identity, andere Authority. Der Magic-Link hat mir das Cookie 'cosign-as nelson@ultranova.io' gegeben. Cookie sagt: andere Person als der Initiator. Co-Sign-Button erscheint."*

**Click „co-sign · admin"**

**Was passiert (~1s):**
- Button zeigt „co-signing…"
- Dann grüner Tag: **„✓ co-signed by nelson · 1 superseded"**
- Nach 0.8s automatischer Page-Refresh
- Pending-Panel ist leer (oder Row weg)
- Im AskCanon-Bereich (wenn man zurück scrollt zu der ursprünglichen Frage): kein Konflikt mehr

**Was zu sagen:**
> *"Drei Signaturen auf der Chain für eine einzige Revenue-Entscheidung: der Vorschlag, das Co-Sign-Event, und das atomare Status-Flip. Niemand hat etwas überschrieben. Alles ist auditierbar. Und schon ist die Wahrheit canonical für jeden Agent im Workspace."*

---

## Sequence 7 — Re-Ask zum Beweis (15s)

**URL:** zurück zu `https://canon.ultranova.io/app`

**Was zu klicken:** AskCanon-Eingabefeld

**Eingabe:** SAME question wieder:
```
Was ist der Konflikt bei Gonzalez Inc monthly_revenue?
```

**Was erscheint:**
- Antwort: vermutlich **„No conflicts"** oder die canonical Antwort `$4,305,773` mit nur einer Citation
- Falls noch andere Konflikte da: nur die nicht-revenue erscheinen

**Was zu sagen:**
> *"Selbe Frage. Konflikt ist weg. Canon hat jetzt eine signierte canonical truth — und die kam durch zwei Augen, nicht eins."*

---

## Pitch-Closer (10s)

**Was zu sagen:**
> *"Drei Verteidigungen ohne Vertrauen in den UI-Layer: Confirm vor jedem Sign, Admin-Reverse als neues signiertes Event falls was schiefging, und 4-Augen für alles was wirklich Geld kostet. Die Crypto-Chain ist die Wahrheit — auch ihre eigenen Korrekturen, auch ihre eigenen Compliance-Regeln."*

---

## Wenn was schiefgeht — Recovery-Pfade

| Problem | Quick-Fix |
|---|---|
| Email kommt nicht an | Refresh https://canon.ultranova.io/app — Pending-Panel zeigt die Row ohnehin. Klick auf "awaiting different admin" zeigt: User ist Initiator. Workaround: zweiten Browser-Account nutzen ODER „der Email-Loop ist Roadmap"-Pivot. |
| Magic-Link landet auf localhost | Hotfix `c419b1a` muss deployed sein. Check via `git log --oneline -3` lokal — sollte commit `c419b1a` (4-eyes hotfix) als jüngsten haben. |
| Co-Sign-Button erscheint nicht obwohl Cookie da | Cookie evtl. expired (30min TTL). Nochmal magic-link aus Email klicken. |
| Pending-Panel leer obwohl gerade erst signiert | Refresh F5 — Server-component muss neu laden. |
| Trust-Gate CI rot | Trust-Gate-Allowlist hat reverse-resolution.ts + cosign-resolution.ts in allen 3 Rules — sollte grün sein. Check `.semgrep/canon-trust-gate.yml` line 62, 65, 126, 127, 166, 167. |

---

## Direkt-URLs (zum Copy-Paste während Aufnahme)

| Beat | URL |
|---|---|
| Hauptseite | `https://canon.ultranova.io/app` |
| Decision-Inbox (Backup-Beat) | `https://canon.ultranova.io/decide` |
| Build-Logs aktueller Deploy | siehe Cursor / Railway Dashboard |
| GitHub Repo | `https://github.com/ThePyth0nKid/canonBigHackBerlin` |

---

## Was als Backup-Plan dabei haben

1. **Screen-Recording vom Run dieser Sequenz** als `4-eyes-demo-backup.mp4` — falls live-Demo bei der Jury bricht
2. **Zwei Browser-Profile parat** falls Single-User-Loop streikt (zweiter Account = Test-Gmail)
3. **Resend-Dashboard offen** in einem Tab (resend.com/emails) — falls Email-Delivery zu zeigen ist
4. **DB-Inspection-Skript ready** falls Audit-Argument vertieft werden soll: zeigt resolution-pending → resolution-cosign → losers superseded auf der Hash-Chain

---

## Vorbereitete Demo-Daten (Inazuma Workspace)

Die folgenden High-Risk-Konflikte SOLLTEN nach einem Sync vorhanden sein:

- `gonzalez_inc.monthly_revenue` — 2 Werte ($351K vs $4.3M) ← **Haupt-Demo-Target**
- Andere möglicherweise verfügbare High-Risk-Metriken: ARR, MRR, contract_value, renewal_date, churn_risk, deal_size

Wenn keine high-risk Konflikte da: nutze SyncButton auf /app oder lass `npx tsx scripts/seed-demo-data.ts` laufen lokal.

---

## Related

- [[4-eyes-full-implementation]] (Architektur-Note)
- [[pick-safety-decision]] (L1+L2+L3-Foundation)
- [[20-ASKCANON-AND-INLINE-RESOLVE-CHECKPOINT]] (Inline-Resolve-Foundation)
