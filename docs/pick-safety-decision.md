---
type: decision
name: "Pick-Safety: 3 Layers gegen versehentliche / falsche / unautorisierte Picks"
status: shipped
created: 2026-04-26
event_day: 2026-04-26
tags: ["#bbh", "#canon", "#decision", "#pick-safety", "#trust-gate"]
---

# Pick-Safety — drei Schichten

> **Trigger:** Stakeholder fragte nach Demo: *„Was, wenn jemand versehentlich den Pick macht?"* — direkter Hit auf eine echte Schwachstelle der bisherigen Inline-Resolve-UI: ein einziger Click → permanente Source-of-Truth.

## Was geshipped wurde (alle auf `main`)

| Layer | Commit | Datei(en) | Was es löst |
|---|---|---|---|
| **L1 — Pre-Pick Confirm** | `a9081d2` | `use-confirm-step.ts`, `confirm-sign-row.tsx`, modifiziert `conflict-resolve.tsx` + `ask-fight-card.tsx` | Fat-finger. „Sign as canonical" morpht in 2-Stufen-Confirm mit 1.5s Cooldown + expliziter Konsequenz-Zeile. Der User MUSS bewusst zweimal klicken. |
| **L2 — Admin Reverse** | `31f58bf` | `admin.ts`, `reverse-resolution.ts`, modifiziert `ask-fight-card.tsx` | Falsche Entscheidung erkannt. Admin signiert ein neues `ReverseResolutionEvent` an Chain-Tip — Losers flippen zurück auf `active`, Original-Resolution kriegt `status='resolution-reversed'`. **Nichts wird gelöscht** — die Audit-Chain liest forwards UND backwards. |
| **L3 — 4-Eyes Co-Sign** | `2151320` | `risk-tier.ts`, `cosign-resolution.ts`, modifiziert `resolve.ts` + `ask-fight-card.tsx` + `canon-trust-gate.yml` | Hoch-Risiko-Felder (ARR, MRR, Contract-Value, Renewal, Churn, …) brauchen 2 Admin-Signaturen. Initiator schreibt `resolution-pending` (kein Supersedure!), zweiter Admin (anderer Email) muss `coSignResolution` ausführen → atomar Status flippen + Loser superseden. |

## Argumentation für Pitch-Q&A

> *„Eine einzelne Person sollte den ARR-Wert nicht stillschweigend setzen können. Drei Verteidigungsschichten: bewusste Confirmation vor jedem Sign; Reverse-by-Admin als eigenes signiertes Event in derselben Chain — nichts wird heimlich gelöscht; und für Hoch-Risiko-Felder ein 4-Augen-Prinzip. Das alles ohne Vertrauen in den UI-Layer — die Crypto-Chain ist die Wahrheit, auch ihre eigenen Korrekturen."*

## Architektur-Notes

- **Pending-Event ist auch signiert.** Selbst ein Pick der nie ko-signiert wird, hinterlässt eine permanente `resolution-pending`-Spur in der Chain. „X hat um 14:32 vorgeschlagen, ARR auf 2.4M zu setzen — keine zweite Admin-Bestätigung." → **Audit-Realität, nicht UI-Vergessen**.
- **Reverse ist ein neues Event, kein Delete.** Original-ResolutionEvent bleibt unverändert in der Hash-Chain. Der Reverse-Event zeigt per `notes: reverse-of:<hash>:reason:<text>` rückwärts. Original kriegt `status='resolution-reversed'` + Pointer zum Reverse via `notes`.
- **Admin-Gate via Env-Var, nicht DB-Schema.** `CANON_ADMIN_EMAILS=a@x,b@y` — wenn unset = jeder eingeloggte User ist Admin (Demo-Mode). Keine Schema-Migration, kein Role-Field. Production setzt die Liste explizit.
- **Risk-Tier als regex-Heuristik.** `arr|mrr|contract|revenue|renewal|churn|deal_size|seats|price|ltv|cac|burn|runway` = high. Erweitert sich von alleine wenn neue ARR-shape Felder durchs Pioneer-Schema kommen. Bewusste False-Positives auf der sicheren Seite.

## Was unterwegs gelernt wurde (nicht-trivial)

### Trust-Gate Exclude-Liste muss neue Resolution-Action-Files explizit erlauben

`.semgrep/canon-trust-gate.yml` blockt jeden direkten `prisma.factEvent.create/update/upsert` außerhalb einer kleinen Allowlist. Bei L2+L3 mussten `reverse-resolution.ts` und `cosign-resolution.ts` zur Allowlist hinzugefügt werden — **mit Begründung als YAML-Kommentar**: *„CanonSigner is the trust boundary, not the file path."* Selbe Argumentation wie für `resolve.ts`.

**Lehre für nächste Resolution-Variante:** wenn ein neues Action-File `prisma.factEvent.create` aufruft, **MUSS** es zur Trust-Gate-Allowlist mit klarem Kommentar hinzugefügt werden, sonst ist die CI rot. Alternative wäre Refactoring zu einem zentralen `signedFactEventWriter()` in `pipeline.ts` — sauberer, aber größerer Eingriff.

### Multi-Agent Race Condition mit gleichzeitigen Edits

Beim Bauen liefen **9 parallele `claude` CLI-Sessions + Cursor-Background-Agent**. Resultat: `resolve.ts` und `ask-fight-card.tsx` wurden wiederholt von anderen Sessions reverted, bevor ich committen konnte. Lösung war ein **isolierter Worktree** (`/Users/nelsonmehlis/Desktop/canon-l3` auf `main`) plus **sofortiges `git add`** nach jedem Write — gestagete Files überleben Filesystem-Reverts weil sie in `.git/objects` liegen.

**Lehre:** für Multi-File-Features mit Risiko paralleler Edits → eigener Worktree + stage-as-you-go. Ist im Setup-Pinning für nächste P-Schicht-Arbeit.

## Demo-Beats

1. **Confirm**: User klickt "Sign as canonical" auf einer normalen Metrik (industry, tier) → Button morpht in roten "Confirm — this becomes Source of Truth" + Cancel. Cooldown 1.5s.
2. **Reverse**: Nach erfolgreichem Sign Klick auf "↺ reverse · admin" auf der Outcome-Footer → Reason-Textarea → "sign reverse-resolution" → Konflikt erscheint wieder, Toast `↺ Reverse-resolution signed at chain tip · N facts re-activated`.
3. **4-Eyes**: Sucht eine Frage zu einer high-risk Metrik (z.B. „Welche Konflikte gibt es bei Bright Plc · ARR?"). Fight-Card zeigt violet `👁️👁️ 4-eyes required` Badge. Pick → violet Pending-Footer mit `awaiting 4-eyes co-sign`. Click auf "co-sign" mit demselben User → ehrlicher Inline-Error: *„Co-sign refused — same email as the initiator. A SECOND admin must sign."* Demo-Punkt: das System ist nicht zu betrügen, nur ehrlich.

## Code-Pfade (alle auf `main`)

```
src/lib/canon/risk-tier.ts                    (NEW — heuristic + helpers)
src/lib/canon/admin.ts                        (NEW — CANON_ADMIN_EMAILS gate)
src/app/app/_actions/resolve.ts               (extended — fourEyes branch)
src/app/app/_actions/reverse-resolution.ts    (NEW — admin reverse signed event)
src/app/app/_actions/cosign-resolution.ts     (NEW — second-admin cosign)
src/app/app/_components/use-confirm-step.ts   (NEW — 1.5s cooldown hook)
src/app/app/_components/confirm-sign-row.tsx  (NEW — shared confirm UI)
src/app/app/_components/ask-fight-card.tsx    (extended — badge, pending footer, reverse footer)
src/app/app/_components/conflict-resolve.tsx  (extended — confirm wired to modal cluster + distinct buttons)
.semgrep/canon-trust-gate.yml                 (extended — allow reverse + cosign actions with justification)
```

## Related

- [[20-ASKCANON-AND-INLINE-RESOLVE-CHECKPOINT]] (predecessor — origineller Inline-Resolve-Loop ohne Pick-Safety)
- [[P1-04-trust-gate-decision]] (Opengrep Trust-Gate Setup)
- [[07-RISKS]] (R7 — Conflict-Resolution-UI fehlt … jetzt erweitert)
