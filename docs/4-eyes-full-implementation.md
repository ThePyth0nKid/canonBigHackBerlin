---
type: decision
name: "4-Augen-Prinzip — Vollausbau mit Tracking + Email-Roundtrip + Magic-Link"
status: shipped
created: 2026-04-26
event_day: 2026-04-26
predecessor: pick-safety-decision.md
tags: ["#bbh", "#canon", "#decision", "#pick-safety", "#4-eyes", "#magic-link"]
---

# 4-Augen-Prinzip — Vollausbau (Level A + B)

> **Trigger:** Stakeholder-Frage *"Können wir das schon tracken? Können wir das schon zeigen?"* — die L3-Implementation aus pick-safety-decision war funktionsfähig aber unvollständig: Pending-Resolutions hatten keine UI-Surface ausserhalb des Initiator-Click-Moments, und ohne zweiten User war der 4-Augen-Loop nicht abschließbar.

## Was geshipped wurde

### Level A — Pending-Resolutions Tracking-Panel (`abdae79` auf main)

| Datei | Zweck |
|---|---|
| `src/lib/canon/pending-view.ts` | Workspace-scoped (NICHT userId-scoped!) Query für `status='resolution-pending'` Rows. Notes-Parser zerlegt `pending:awaiting-cosign:tier=high:initiator=…:winner=…:losers=…` in typed `PendingResolution[]`. |
| `src/app/app/_components/pending-resolutions-panel.tsx` | Violet-themed Panel über AskCanon. Pro Row: viewer === initiator → "awaiting different admin"; viewer ≠ initiator → grüner "co-sign · admin" Button. |
| `src/lib/canon/cosign-cookie.ts` | HMAC-signiertes httpOnly Cookie `canon_cosign` mit `{resolutionFactId, asEmail, exp}`. 30min TTL. Gleiche `MAGIC_LINK_SECRET` wie persona-cookie. |
| `_actions/cosign-resolution.ts` (modify) | Dual-path admin-Gate: OAuth-Session-Admin ODER cosign-Cookie tied to specific resolutionFactId. Pending-Lookup + Loser updateMany sind workspace-scoped (kein userId-Filter mehr). |
| `src/app/app/page.tsx` (modify) | Lädt `loadPendingResolutions(workspace)` + `readCosignFocusCookie()`, rendert Panel. |

**Architektur-Schlüsselentscheidung:** Pending-Rows haben den userId des Initiators. Ein zweiter Admin (anderer OAuth-Account = anderer userId) MUSS sie aber sehen + ko-signieren können. Lösung: Workspace-Filter ersetzt userId-Filter; `CANON_ADMIN_EMAILS`-Env ist die Authority.

### Level B — Email-Roundtrip + Magic-Link Cosign (`df865f0` auf main)

| Datei | Zweck |
|---|---|
| `src/lib/canon/cosign-mail.ts` | `signCosignToken` / `verifyCosignToken` / `buildCosignMagicUrl` / `sendCosignRequestEmails` / `pickCosignRecipients`. Mirror von decide-mail.ts: HMAC über `resolutionFactId.asEmail.exp`, 24h TTL, Resend dispatch. |
| `src/app/app/cosign/route.ts` | GET-Handler für `/app/cosign?res&as&exp&sig`. Verifiziert Token, double-checkt asEmail in `CANON_ADMIN_EMAILS`, setzt `canon_cosign` Cookie, 302 zu `/app#pending-<id>`. Bad token → `/app?cosign_error=…`. |
| `_actions/resolve.ts` (modify) | Im `fourEyes`-Pfad nach Pending-FactEvent-Write: `sendCosignRequestEmails(pickCosignRecipients(initiator))`. Try/catch — Resend-Outage failed nicht den Pending-Write. |
| `/app page.tsx` (modify) | Surface `?cosign_error=…` als rose Banner. |

### Configuration

```
CANON_ADMIN_EMAILS=nelson.mehlis@igoultra.de,nelson@ultranova.io
```

Diese Env-Var auf Railway gesetzt. Solo-Demo-Loop:
- Initiator-Login: nelson.mehlis@igoultra.de (Google OAuth)
- Cosign-Email-Empfänger: nelson@ultranova.io (= `CANON_DEMO_TO`, Resend liefert dorthin)
- Beide sind im Admin-Pool, beide unterschiedlich → 4-eyes Rule erfüllt
- User klickt Magic-Link aus seinem eigenen Posteingang → Cookie wird auf `as=nelson@ultranova.io` gesetzt → Cosign authorisiert (nicht-Initiator) → done

## Demo-Script (60 Sekunden 4-Augen-Beat)

1. **„Ich bin als Sales eingeloggt"** — zeigt Identity-Badge oben rechts: `N · signed in · nelson.mehlis@igoultra.de`
2. **„Ich frag Canon nach einer high-risk Metrik"** — AskCanon: *"Welche Konflikte gibt es bei Inazuma · ARR?"*
3. **Fight-Card erscheint mit violetem `👁️👁️ 4-eyes required` Badge**. Pitch: *„Sobald es um Geld geht, gilt das 4-Augen-Prinzip — jede Person die das hier ändern will, braucht eine zweite Bestätigung."*
4. **Click „Sign as canonical"** → Confirm-Strip → bestätigt → Pending-Footer zeigt *"awaiting 4-eyes co-sign"*
5. **Scroll hoch zum Pending-Panel** — *"Da ist mein Vorschlag, schon signiert auf der Chain. Aber die alten Werte sind noch active. Nichts wurde überschrieben."*
6. **Email auf Phone öffnen** — Subject `[for nelson@ultranova.io] 4-eyes co-sign needed: Inazuma · ARR = 2.4M`
7. **Magic-Link tippen** → `/app/cosign?res=…&token=…` → 302 → `/app#pending-…`
8. **Pending-Panel highlightet die Row mit violet ring** — Pitch: *„Andere Identität, andere Authority. Der zweite Admin sieht den Vorschlag, klickt jetzt drauf."*
9. **Click „co-sign · admin"** → Server signiert Cosign-Event, flippt Pending → Resolution, Loser → superseded → Panel-Row verschwindet, Toast *„✓ Co-signed · 3 facts superseded"*
10. **Re-Ask die gleiche Frage** — Konflikt ist weg.

**Pitch-Closer:** *„Drei Signatures auf der Chain für eine einzige ARR-Entscheidung. Der Vorschlag, das Co-Sign, und das atomare Status-Flip. Nichts wurde überschrieben, alles ist auditierbar. Das ist 4-Augen für AI-Agenten."*

## Architektur-Notes für Q&A

**Wieso nicht Workspace-Roles in der DB?** Schema-Migration mit User+Role+Workspace-Tabellen wäre die V2-Lösung. Für Demo + V1 reicht `CANON_ADMIN_EMAILS` Env-List — gleiches Pattern wie `/decide` für Persona-Email-Routing. Pitch-Antwort: *„In production ist das role-based pro Workspace, hier per env list für die Demo-Geschwindigkeit."*

**Wieso schickt das System eine Email statt nur ein In-App-Notification?** Weil das `/decide`-Pattern (Customer-Decision-Inbox via Email) schon die Email-Roundtrip-Architektur etabliert hat. **Eine Architektur, zwei Use-Cases**: `/decide` für Customer-Asks, `/app/cosign` für Internal-Compliance. Selber `MAGIC_LINK_SECRET`, selbe Resend-Pipeline, selbes HMAC-Token-Pattern, selbe Cookie-Authority. Code-Reuse: ~60 % Pattern-Wiederverwendung.

**Wieso Cookie statt Token-im-URL?** Weil Server-Actions vom Client per onClick gefeuert werden — Token im URL würde durch jede Komponente threaden müssen. Cookie ist die saubere RBAC-Anchor. Token landet niemals in Browser-History oder Referrer-Headers — nach `/app/cosign`-Hit ist die URL clean.

**Wieso Pending-Event auf der Chain selbst wenn niemand ko-signiert?** Weil die Audit-Realität wichtiger ist als die UI-Kosmetik. Permanent-Trace: *"Person X hat um T 14:32 vorgeschlagen, ARR auf 2.4M zu setzen. Kein zweiter Admin hat zugestimmt."* Das ist forensisch wertvoll auch wenn nichts zu canonical wird.

**Wieso `same-as-initiator` als ehrlicher Reject?** Weil das System nicht so tun sollte als ginge es. Die Single-User-Demo (ohne CANON_ADMIN_EMAILS-Setup) zeigt den Reject als Feature, nicht als Bug. *„Das System lässt sich nicht alleine austricksen."*

## Code-Pfade Vollausbau

```
src/lib/canon/
  pending-view.ts            (NEW — workspace-scoped query + notes parser)
  cosign-cookie.ts           (NEW — HMAC cookie scoped to resolutionFactId)
  cosign-mail.ts             (NEW — token signing + Resend dispatch)
  admin.ts                   (existing from L3 — admin gate via env)
  risk-tier.ts               (existing from L3 — high-risk metric heuristic)

src/app/app/
  page.tsx                   (modify — load pending + cookie + render panel)
  cosign/route.ts            (NEW — magic-link landing handler)
  _components/
    pending-resolutions-panel.tsx  (NEW — tracking UI)
    ask-fight-card.tsx       (existing — pending footer renders + cosign button)
  _actions/
    resolve.ts               (modify — fire cosign emails on pending write)
    cosign-resolution.ts     (modify — cookie-auth path + cross-userId queries)

.semgrep/canon-trust-gate.yml   (existing from L3 — cosign-resolution.ts excluded
                                 from prisma.factEvent.create rule, all 3 rules)
```

## Env-Konfiguration auf Railway (verifiziert)

- ✅ `MAGIC_LINK_SECRET` — gleicher wie für /decide
- ✅ `RESEND_API_KEY` — gleicher Resend account
- ✅ `CANON_DEMO_TO=nelson@ultranova.io` — wo alle Magic-Link-Emails landen
- ✅ `AUTH_URL=https://canon.ultranova.io` — base URL für magic-links
- ✅ `CANON_ADMIN_EMAILS=nelson.mehlis@igoultra.de,nelson@ultranova.io` — Admin-Pool für 4-eyes

## Related

- [[pick-safety-decision]] (predecessor — original L1+L2+L3 ohne Tracking-Panel)
- [[20-ASKCANON-AND-INLINE-RESOLVE-CHECKPOINT]] (AskCanon Inline-Resolve Foundation)
- [[P1-04-trust-gate-decision]] (Opengrep Trust-Gate, allowlist erweitert für cosign-resolution.ts)
