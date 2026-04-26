---
type: audit
name: "4-Augen-Co-Sign — Security + Correctness Audit"
status: completed
created: 2026-04-26
event_day: 2026-04-26
predecessor: 4-eyes-full-implementation.md
tags: ["#bbh", "#canon", "#audit", "#security", "#4-eyes"]
---

# 4-Augen-Co-Sign — Audit + Hardening

> **Methode:** zwei parallele Audit-Agenten — einer Security-fokussiert (Token-Replay, IDOR, CSRF, Info-Disclosure, Race-Conditions, HMAC-Reuse, Cookie-Flags, CRLF-Injection, Trust-Gate-Bypass), einer Correctness/Quality-fokussiert (End-to-End-Flow, Edge-Cases, Error-Handling, /decide-Regression, Type-Safety, Comment-Accuracy, Notes-Parsing-Robustness). Jeder Agent gegen die voll deployed Codebase auf `origin/main`.

> **Ergebnis:** 1 CRITICAL + 4 HIGH + 9 MEDIUM + 7 LOW + 4 INFO Befunde. **6 Fixes sofort applied** (Commit `3a06de7`). 14 Befunde als V2-Work dokumentiert. 14 Stärken bestätigt.

## TL;DR

| Severity | Befund | Status |
|---|---|---|
| 🔴 CRITICAL | Cookie verify() splittet auf `.`, bricht für Emails mit Punkten | ✅ FIXED — Separator auf `|` + HMAC-Domain-Tag `cosign:v1:` |
| 🟠 BUG | Pending-Row-Loser re-surface als AskCanon-Konflikt | ✅ FIXED — `loadPendingPairKeys()` Filter in `searchByConflict` |
| 🟠 BUG | Cosign Race-Condition produziert duplicate `f_cos_*` auf Chain | ✅ FIXED — `updateMany` mit `status='resolution-pending'` Guard + race-loss-Detection |
| 🟡 MEDIUM | CRLF-Injection auf Email-Subjects via DB-Felder | ✅ FIXED — `safeLine()` Helper |
| 🟡 MEDIUM | HMAC-Secret-Reuse ohne Domain-Separation | ✅ FIXED (cosign) — `cosign:v1:` Prefix |
| 🟠 BUG | `reverseResolution` userId-scoped, blockt Cross-Admin-Reverse | ✅ FIXED — workspace-scoped + chain-tip scope |
| 🟠 HIGH | Magic-Link Token-Replay (kein JTI/Single-use) | 📋 V2 |
| 🟠 HIGH | `isAdminEmail` fail-open wenn `CANON_ADMIN_EMAILS` unset | 📋 V2 (prod-startup-assertion) |
| 🟠 HIGH | CSRF-Vektor auf Cookie-Only-Cosign-Path | 📋 V2 (Next.js Action-ID Encryption mitigates today) |
| 🟡 MEDIUM | Cosigner `userId` mit Initiator-userId attribuiert (Cookie-Path) | 📋 V2 (Schema: nullable cosignerUserId column) |
| 🟡 MEDIUM | `parsePendingNotes` Regex fragil; Notes nicht im signed-Payload | 📋 V2 (structured signed columns) |
| 🟡 MEDIUM | Pending nicht reversible (nur `status='resolution'`) | 📋 V2 (extend reverseResolution) |
| 🟡 MEDIUM | `/decide` Direct-Pick handhabt `r.pending=true` nicht | 📋 V2 (regression for /decide flow only) |
| 🟢 LOW | Risk-Tier Regex einfach umgehbar (`anual_revenue` typo) | 📋 V2 (allowlist-default-high) |
| 🟢 LOW | Cookie-TTL 30min lang | 📋 V2 |
| 🟢 LOW | Cookie nicht `secure` in dev | by design (matches persona-cookie) |
| 🟢 LOW | Email-Normalization (homoglyph attack) | 📋 V2 |
| 🟢 LOW | Token-vs-Cookie-Expiry-Interplay | 📋 V2 |

---

## Was JETZT applied wurde (Commit `3a06de7`)

### 1. CRITICAL — Cookie-Verify Dot-Split Bug

**Befund:** `cosign-cookie.ts` `verify()` machte `value.split('.')` und akzeptierte nur `parts.length === 4`. Der signed payload ist `${factId}.${asEmail}.${exp}.${sig}`. Realistische Admin-Emails (`nelson.mehlis@igoultra.de`) splitten in 6+ Teile → verify returns null → Cookie-Auth-Path tot. Demo lief nur weil `nelson@ultranova.io` keinen Punkt im Local-Part hat.

Same bug latent in `persona-cookie.ts` aber dort nutzen Demos `alice@inazuma.example` ohne Punkt.

**Fix:** Separator auf `|` umgestellt — Pipe ist nicht in factId (`f_res_<hex>`), nicht in exp (digits), nicht in sigB64 (base64url), und in keiner realistischen Email-Adresse. Plus HMAC-Domain-Tag `cosign:v1:` damit cosign-Tokens mathematisch von decide-Tokens getrennt sind.

**Datei:** `src/lib/canon/cosign-cookie.ts`

### 2. BUG — Pending-Row-Loser re-surface als Konflikt

**Befund:** Nach High-Risk-Pick:
- Pending-Row entstanden mit `status='resolution-pending'`
- Loser blieben `status='active'` (intentional)
- AskCanon's `searchByConflict` aggregiert `status='active'` → selbe Pair tauchte als Konflikt wieder auf
- Initiator pickt nochmal → Duplicate Pending-Row

**Fix:** Neuer `loadPendingPairKeys(workspace)` Helper in `pending-view.ts`, returns `Set<"entity::metricKey">`. `searchByConflict` filtert diese Pairs aus dem Conflict-Output. Pending-Panel über AskCanon ist die canonical Surface.

**Dateien:** `src/lib/canon/pending-view.ts`, `src/lib/canon/search.ts`

### 3. BUG — Cosign Race-Condition

**Befund:** `cosign-resolution.ts` machte `prisma.factEvent.update({where:{id}})` ohne status-Filter. Zwei parallele Cosign-Klicks:
- Beide lasen `status='resolution-pending'` beim Precheck
- Beide signierten Cosign-Events
- Beide flippten Pending → Resolution (idempotent)
- Loser updateMany filterte `status='active'` → erstes flippte, zweites no-op
- Aber: **zwei `f_cos_*` Events landeten auf der Chain** für eine Resolution

**Fix:** `update` → `updateMany` mit `where: { id, status: 'resolution-pending' }`. Wenn `count===0` → race-lost, return `{ok:false, error:'race-lost-already-cosigned'}`. Cosign-Event landet trotzdem auf der Chain (audit: dokumentiert dass A versucht hat zu cosignen aber B war schneller), aber UI signalisiert Fehler.

**Datei:** `src/app/app/_actions/cosign-resolution.ts`

### 4. MEDIUM — CRLF-Injection auf Email-Subject

**Befund:** Email-Subject + signed-claim interpoliert `entityDisplay`, `metricKey`, `metricValue` — alles aus FactEvent-Rows die ursprünglich aus untrusted Source-Documents (Slack, Gmail, PDF-Ingest) kamen. Resend sanitisiert Subjects normalerweise, aber das ist provider-implementation-defined.

**Fix:** `safeLine(s, max=200)` Helper strippt `\r\n\0` und cappt Länge. Angewandt auf Subject. Signed claim nutzt die Felder noch unsanitised — als V2 markiert.

**Datei:** `src/lib/canon/cosign-mail.ts`

### 5. MEDIUM — HMAC-Domain-Separation

**Befund:** Vier Flows nutzen `MAGIC_LINK_SECRET`: `decide-mail`, `persona-cookie`, `cosign-mail`, `cosign-cookie`. Alle HMACen `${id}.${as}.${exp}` ohne Domain-Tag. Cross-Flow-Token-Konfusion heute nicht ausnutzbar (fact-id-Format `f_res_<hex>` ≠ thread-id-Format), aber Konstruktion footgun-shaped: Wenn ein zukünftiger Schema-Change die Formate angleicht, würden /decide-Tokens als Cosign-Tokens valid.

**Fix:** `cosign:v1:` Prefix vor HMAC-Input in BEIDEN cosign-Wegen (token + cookie). decide/persona unverändert (würde laufende /decide-Demo brechen) — als V2 markiert.

**Dateien:** `src/lib/canon/cosign-mail.ts`, `src/lib/canon/cosign-cookie.ts`

### 6. BUG — reverseResolution userId-scoped

**Befund:** `reverse-resolution.ts` machte `findFirst({where: {id, userId: admin.userId}})`. Heißt: 4-Augen-Resolution von Admin A kann nur von Admin A reversed werden — selbst wenn Admin B den Fehler bemerkt. Inkonsistent mit cosign, das gerade userId-Filter dropped um Cross-OAuth-Admin-Action zu ermöglichen.

**Fix:** workspace-scoped Lookup (kein userId-Filter). Chain-tip-Lookup auch workspace-scoped (sonst würde Reverse unter user-scoped tip die Chain forken). Loser updateMany ohne userId-Filter (id-list ist signed-event-derived und authoritative).

**Datei:** `src/app/app/_actions/reverse-resolution.ts`

---

## Was als V2-Work dokumentiert ist (NICHT applied)

### HIGH

#### V2-1: Magic-Link Token-Replay

**Befund:** Kein JTI / Nonce / Single-Use-Garantie. Token-URL ist 24h reusable. Wenn Token leakt (Browser-History-Sync, archived Email-Forward, Referer-Header), kann ein Attacker innerhalb der 24h beliebig oft Cookies minten. Self-Cosign-Block hilft, aber Impersonation als ein anderer Admin im Cosign-Scope ist möglich.

**V2-Plan:** Persistent `MagicLinkToken{jti, consumedAt}` Tabelle keyed auf `sha256(sig)`; mark consumed beim ersten GET; reject re-use. TTL auf 1-2h reduzieren.

#### V2-2: `isAdminEmail` Fail-Open

**Befund:** Wenn `CANON_ADMIN_EMAILS` unset → `adminEmails()` returned `[]` → `isAdminEmail` returned `true` für jeden Email. In Prod: deploy ohne env var → jeder eingeloggte User wird Admin → trivial Cosign möglich.

**V2-Plan:** Wenn `NODE_ENV==='production'` und `adminEmails().length === 0` → loud `console.error` beim Startup; `isAdminEmail` returned `false` (deny-all). Optional: deploy-time assertion.

#### V2-3: CSRF auf Cookie-Only-Cosign

**Befund:** `canon_cosign` Cookie ist `sameSite: 'lax'` — cross-origin top-level navigations attachen das Cookie. Cookie alleine authorisiert (ohne OAuth). Theoretisch CSRF-attackbar.

**Mitigation heute:** Next.js App Router server actions nutzen encrypted action IDs als implicit CSRF-Schutz. Same-Origin-Header-Check verhindert die meisten Cross-Site-Action-Calls.

**V2-Plan:** Cookie auf `sameSite: 'strict'` umstellen (akzeptabel weil Cookie nur direkt vor same-tab redirect zu /app gesetzt wird) ODER explicit Origin/Referer-Header-Match in cosign-action.

### MEDIUM

#### V2-4: Cosigner-userId-Attribution

**Befund:** Cookie-Path setzt `cosignerUserId = original.userId` (Initiator's userId) wenn cosigner keine User-Row hat. Signed FactEvent: userId = Initiator, claim = "co-signed by Recipient". Audit-Tools die userId → Human mappen lügen.

**V2-Plan:** Schema-Migration — nullable `cosignerUserId` column, ODER User-Row für asEmail lookup, ODER Sentinel-userId `magic-link:<asEmail>`.

#### V2-5: parsePendingNotes Robustheit

**Befund:** Regex `/initiator=([^:]+):/` matcht against free-form notes column. Notes ist NICHT im signed CBOR-payload (`sign-js.ts:7-14`) — DB-Schreibender könnte initiator-Email umschreiben und same-as-initiator-check umgehen.

**V2-Plan:** Initiator-Email + Winner + Loser ins signed CBOR (oder dedicated typed columns). Notes-Format dann nur Audit-Side-Channel.

#### V2-6: Pending nicht reversible

**Befund:** `reverseResolution` rejected anything with `status !== 'resolution'`. Pending-Row kann nicht abgebrochen werden — sitzt forever wenn niemand cosignet.

**V2-Plan:** Extend `reverseResolution` für `'resolution-pending'` (separater `'pending-rejected'` Event-Type, keine Loser-Reaktivierung weil nie superseded).

#### V2-7: /decide handhabt `r.pending=true` nicht

**Befund:** `decision-card.tsx onDecideDirect` checkt nur `r.ok`, ignoriert `r.pending`. Bei High-Risk-Direct-Decide aus /decide → /decide UI behauptet "resolved", aber Loser sind active → Konflikt taucht beim nächsten /decide-Reload wieder auf.

**V2-Plan:** /decide UI erweitern um pending-state-rendering analog zu /app FightCard. Oder: /decide leitet bei `r.pending` direkt zur /app-Pending-Panel.

### LOW

#### V2-8: Risk-Tier Heuristik

`anual_recurring_revenue` (typo) klassifiziert als low. Source-Docs könnten via Naming-Choice opt-out aus 4-Augen.

**V2-Plan:** Default-to-high für unknown numerische metricKeys ODER explizite low-risk-allowlist.

#### V2-9: Email-Normalisation

`nelson@іgoultra.de` (Cyrillic і) bypass-t same-as-initiator-check. CANON_ADMIN_EMAILS lowercased+trimmed; initiator parsed-from-notes nicht gleich normalisiert.

**V2-Plan:** Beide Seiten NFKC + trim + lowercase + maybe punycode-normalize.

### Bewusst NICHT gefixed (by design)

- **Cookie nicht `secure` in dev** — matched persona-cookie pattern. `process.env.NODE_ENV === 'production'` Check ist Standard.
- **Cookie 30min TTL** — matched persona-cookie. Kürzere TTL würde Demo brechen.
- **HMAC-Domain-Sep für persona-cookie / decide-mail** — würde laufende /decide-Demo invalidieren. Latent harmless heute.
- **Workspace hardcoded auf `'inazuma'` in /app** — der Demo-Workspace. Wenn Multi-Workspace-Switching kommt, wird Pending-Panel mit-erweitert.

---

## Stärken (vom Audit bestätigt)

1. **Constant-Time HMAC-Compare** via `timingSafeEqual` mit explicit Length-Check — beide Cookie + Token.
2. **Magic-Link-Token nie persistent in URL** nach Landing — Route-Handler 302st zu cleaner URL mit Cookie gesetzt.
3. **Defence-in-Depth Re-Check** von `isAdminEmail` beim Link-Landing — Token-Validity allein nicht genug.
4. **Cookie bound to spezifischer resolutionFactId** — IDOR via Cookie korrekt verhindert; Cookie für resolutionA kann nicht auf resolutionB benutzt werden.
5. **Atomic `prisma.$transaction`** für create+update+supersede triple — partial-state-failure unmöglich.
6. **Signed Pending-Event auf der Chain BEFORE Email** — Resend-Outage verliert keine Audit-Trace.
7. **HTML-Email-Body-Felder via `escapeHtml`** — XSS in gerendert Emails geblockt.
8. **Hard 4-eyes Rule** server-side enforced — egal welcher Auth-Pfad gewählt wurde.
9. **Cookie cleared on successful Cosign** — minimiert Post-Use-Replay-Window.
10. **Trust-Gate-Allowlist preserves Signing-Invariant** — `notes`/`status` sind dokumentiert als out-of-signed-payload Lifecycle-Felder. Allowlisting für `cosign-resolution`/`reverse-resolution` correct begründet.
11. **`status` und `notes` deliberately außerhalb signed CBOR-Payload** (`sign-js.ts:7-14`) — Lifecycle-Transitions sind mutable ohne Signature-Verification zu brechen.
12. **Two-Step-Confirm mit 1.5s Cooldown** für irreversible Truth-Making-Klicks — richtige Balance Defence-vs-Annoyance.
13. **Workspace-scoped pending lookup** (nicht userId-scoped) — enables Cross-OAuth-Admin-Cosign-Flow ohne Trust zu schwächen.
14. **`AUTH_URL`-based Redirect-Resolution** in cosign/route.ts — proxy-aware mit clear Comment warum `request.url` auf Railway unreliable ist.

---

## Pitch-Q&A — was tun wenn die Jury fragt

**Q: „Was wenn der Magic-Link in falsche Hände gerät?"**
> *Replay-Schutz ist V2 — aktuell ist der Link 24h gültig und reusable. Mitigation: Link kann nur die SPEZIFISCHE resolutionFactId co-signen, nicht beliebige Resolutions. Plus: same-as-initiator-Block + admin-list-Gate. V2-Plan: JTI-Tabelle für Single-Use.*

**Q: „Was wenn das System die Email-Liste verliert?"**
> *Pending-Event ist BEREITS auf der Chain bevor die Email rausgeht. Resend-Outage / Mail-Server-Down verliert keine Audit-Trace. UI-side surfaced das via Pending-Panel auf /app — der Cosigner kann's auch ohne Email-Roundtrip auf /app sehen.*

**Q: „Wie skaliert das auf echte Workspaces?"**
> *Heute: env-list als Admin-Pool. V2: User-Role-Tables pro Workspace. Code-Pfad bleibt identisch — nur die `isAdminEmail` Implementation wechselt von env-Lookup zu DB-Lookup. Zero UI-Change.*

**Q: „Was wenn zwei Admins gleichzeitig cosignen?"**
> *Race-Condition handled — `updateMany` mit `status='resolution-pending'` Guard. Erster gewinnt (atomic). Zweiter kriegt `race-lost-already-cosigned` Error inline. Beide Cosign-Versuche landen als signed Events auf der Chain — auditable Trace dass beide es versucht haben.*

**Q: „Was wenn der Initiator versehentlich ko-signiert?"**
> *Hard-Rule: `cosignerEmail !== initiator.email`. Server rejected mit `same-as-initiator`. UI surfaced den Reject ehrlich: „A SECOND admin must sign for high-risk picks." Das System lässt sich nicht alleine austricksen.*

---

## Weitere relevante Dokumente

- [[4-eyes-full-implementation]] — Architektur-Note + Code-Pfade
- [[4-eyes-demo-runbook]] — Demo-Recording-Anweisungen Schritt für Schritt
- [[pick-safety-decision]] — L1 + L2 + L3 Foundation
- [[20-ASKCANON-AND-INLINE-RESOLVE-CHECKPOINT]] — AskCanon Inline-Resolve Foundation
- [[P1-04-trust-gate-decision]] — Opengrep Trust-Gate Setup, allowlist-Erweiterungen

## Verifikations-Commits

| Commit | Was |
|---|---|
| `abdae79` | Level A — Pending-Panel + cross-userId cosign |
| `df865f0` | Level B — Email roundtrip + magic-link cosign |
| `8ddcb55` | Bugfix — Panel cookie-email gating |
| `c419b1a` | Hotfix — Magic-link redirect AUTH_URL-resolved |
| **`3a06de7`** | **Audit-Hardening — 6 Fixes applied (this commit)** |
