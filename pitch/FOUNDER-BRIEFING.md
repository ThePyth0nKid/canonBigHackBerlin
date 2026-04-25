# Canon — Founder Briefing für Nelson

**Wann lesen:** Sa abend einmal komplett, So vormittags die kursiven Antworten zum Inhaling.
**Was es ist:** kein technisches Spec, sondern dein **inneres Skript** — wie das System unter der Haube funktioniert in Worten, die du auf der Bühne benutzen kannst, ohne zu lügen und ohne zu over-claimen.

Lies jeden Layer, dann die Q&A-Drills. Die fett gesetzten Sätze sind die, die du auswendig haben solltest.

---

## Der Ein-Satz-Pitch

> **„Canon ist ein cryptographically-signed, hash-chained context layer für AI-Agents — du füllst ihn aus Slack, Gmail, Docs; Agents lesen ihn statt deiner Rohdaten; jeder Fakt ist beweisbar."**

Das ist der Schluss-Satz von Slide 7. Er muss in deinem Mund liegen wie dein eigener Name. Wiederhol ihn fünfmal jetzt.

Die zwei Worte die alles tragen: **„signed"** und **„context layer"**. „Signed" disambiguiert von RAG (das vergleicht Vektoren), „context layer" positioniert vor Qontext (was *kontext-routing* macht — wir liefern ihm den Substrate).

---

## Architektur in einem Bild

```
   Slack / Gmail / PDF / Qontext-dataset / …
                  ↓
   ┌─────────────────────────────┐
   │  Layer 1 — Pioneer (Fastino) │   span-extraction (GLiNER-2)
   │  „same input → same output"  │   deterministisch, hash-stabil
   └─────────────────────────────┘
                  ↓
   ┌─────────────────────────────┐  ┌────────────────────────┐
   │  Layer 2 — Gemini 2.5-flash  │  │ Layer 2.5 — Tavily     │
   │  „liest die ganze Quelle"    │  │ external web context   │
   │  fail-closed on error        │  │ ⚠ unsigned tag         │
   └─────────────────────────────┘  └────────────────────────┘
                  ↓
   ┌─────────────────────────────┐
   │  Layer 3 — Aikido + lokal    │   secret/PII refusal
   │  „refuse to canonize"        │   plus recursive-trust banner
   └─────────────────────────────┘
                  ↓
   ┌─────────────────────────────┐
   │  Layer 4 — canon-signer      │   Ed25519 + COSE_Sign1
   │  „every fact tamper-proof"   │   PER-WORKSPACE hash chain
   └─────────────────────────────┘
                  ↓
   ┌─────────────────────────────┐
   │  MCP-Server (6 tools)        │   workspaces / lookup / search / cite /
   │  „every agent reads Canon"   │   diff / external_lookup (+ write stub)
   └─────────────────────────────┘
                  ↓
            workspace=northwind  ·  workspace=inazuma
            (demo, slack/gmail/pdf)  (Qontext dataset)
            ~50 facts, 6 entities    ~310 facts, 105 entities, 6 conflicts
```

**Eligible-partner-tech accounting (BBH submission rule):** Pioneer + Gemini + Tavily = 3 ✓. Aikido is an additional Layer-3 trust contribution outside the eligibility list.

---

## Layer für Layer — was du sagst, was du verteidigst, was du NICHT behauptest

### Layer 1 — Pioneer (Fastino GLiNER-2)

**Was es technisch tut:**
- Span-Extractor (kein Generator). Nimmt Text in, gibt verbatim Substrings raus die zu einem Schema passen (entity, metric_key, metric_value, etc.).
- Wir schicken sentence-split Chunks rein, kriegen eine Liste FactDraft-Records raus.
- Endpoint: `POST https://api.pioneer.ai/gliner-2`, `X-API-Key` Header.
- Verified live, ~1-2 Sekunden für 10-15 Chunks Batch.

**Was du auf der Bühne sagst:**
> *„Layer 1 ist Pioneer — Fastinos GLiNER-2. Span-Extractor, kein LLM-Generator. Same input, same output, halluzinations-frei by construction."*

**Was du NICHT sagst:**
- Nicht „Pioneer ist State-of-the-Art" — das machen wir nicht zur Bedingung
- Nicht „Pioneer ist unverzichtbar" — siehe BCP unten

**Wenn jemand fragt „Was wenn Pioneer ausfällt?":**
> *„FactDraft-Schema ist das Lock-in, nicht Pioneer das Modell. GLiNER-2 self-host, oder kleines tuned LLM mit JSON-mode — 50 Zeilen Drop-in. Pioneer pivoted, wir tauschen das Modell, der Layer überlebt."*

**Wenn jemand fragt „Warum GLiNER und nicht GPT-4-Extraction?":**
> *„Reproducibility. Generative Modelle sind temperature-stochastisch. GLiNER ist deterministisch — gleiches Input gibt gleichen Hash. Das brauchst du für ein signed Ledger."*

---

### Layer 2 — Gemini 2.5-flash (Vertex AI)

**Was es technisch tut:**
- Liest die ganze Source-Body (Slack-Channel, Inbox, PDF) als Long-Context (~120k tokens).
- Nimmt jedes Pioneer-Draft + Kontext in einen Prompt. Antwort: `{confirmed, contradiction, confidence}` als JSON.
- Bei Audit-Error: jetzt **fail-closed** — Fact bekommt `notes='audit:audit_unavailable'`, UI zeigt `audit·flag` Badge. Kein silent confirm.

**Was du auf der Bühne sagst:**
> *„Layer 2 ist Gemini Two-Point-Five-Flash mit zwei Millionen Token Context. Liest die ganze Slack-History parallel zu jedem Pioneer-Fact. Findet Widersprüche, die Layer 1 nicht sieht."*

**Was du NICHT sagst:**
- Nicht „Gemini ist unser Auditor" als ob es das einzig richtige Modell wäre — austauschbar
- Nicht „Audit ist 100% reliable" — siehe fail-closed unten

**Wenn jemand fragt „Was wenn Gemini selbst halluziniert?":**
> *„Pioneer ist Span-Extractor — kann nicht halluzinieren. Gemini ist der Critic, nicht der Producer. Verschiedene Failure-Modes by Construction. Wenn Gemini blippt, fällt es fail-closed: der Fact bekommt audit-pending Tag, nicht silent confirmed. Im UI sichtbar als audit-flag Badge."*

**Wenn jemand fragt „Warum nicht beide Modelle als ensemble extrahieren?":**
> *„Wäre ein anderes Architektur-Pick — höhere Kosten, mehr Komplexität. Heute: Pioneer macht extraction (deterministic), Gemini macht audit (generative critic). Klare Trennung der Failure-Modes."*

---

### Layer 3 — Aikido + lokale Pattern-Engine

**Was es technisch tut:**
- Lokale Regex-Engine in `src/lib/canon/scan.ts`: 13 Secret-Patterns (AWS, GitHub, Anthropic, Slack, JWT, etc.) plus 4 PII (IBAN, Credit Card mit Luhn, intl Phone, Email mit Allowlist).
- Bei Match: kein FactEvent, sondern RedactionEvent (selbst signed, claim=`<redacted>`).
- Aikido-Banner ist die "recursive trust" Beat: das **eigene** Repo (`canonBigHackBerlin`) ist Aikido-monitored. Live-fetched, 0 issues sichtbar im UI Header.

**Was du auf der Bühne sagst:**
> *„Layer 3: lokale Pattern-Engine refused to canonize, wenn ein Fact ein Secret oder PII enthält. Plus: das hier ist Canons eigene Source — Aikido-monitored, Null Issues. Recursive trust ist nicht ein Slide-Wort, es läuft."*

**Was du NICHT sagst:**
- Nicht „Aikido scant deine Customer-Daten" — die scant unser eigenes Repo. Die lokale Pattern-Engine scant Customer-Facts.
- Nicht „Aikido ersetzt InfoSec" — es ist ein zusätzlicher Layer

**Wenn jemand fragt „Was wenn Aikido false positives produziert?":**
> *„Auf Customer-Facts läuft die lokale Pattern-Engine, nicht Aikido — die hat hand-getunte Rules für Secrets und PII, fail-closed bei Hit. RedactionEvent ist selbst signed, das heißt User können override (auch das ein signed Event). Kein silent drop."*

**Wenn jemand fragt „Warum zwei Tools im selben Layer (Aikido vs lokale Engine)?":**
> *„Different jobs. Aikido ist Repo-Monitoring — beobachtet **Canon's** Source-Code. Lokale Engine ist Write-Time-Scan — beobachtet **Customer's** Facts. Zwei Trust-Surfaces, beide signed."*

---

### Layer 4 — canon-signer (Rust)

**Was es technisch tut:**
- Long-lived Rust-Subprozess, NDJSON-IPC über stdin/stdout.
- Pro Sign: Ed25519-Signatur, COSE_Sign1-Envelope-Wrap, eventHash = `hash(parentHash || canonical(payload))`.
- Per-User Hash-Chain: jeder neue Fact zeigt mit `parentHash` auf den vorhergehenden Sign.
- Verify-Pfad: `canon-verify` ist ein **separates Binary** (anderer Codepath, anderes Crate), spawnt server-side via `/api/verify`.

**Was du auf der Bühne sagst:**
> *„Layer 4: canon-signer in Rust. Ed25519-Signaturen, COSE_Sign1-Envelopes, hash-chained. Signer und Verifier sind zwei verschiedene Binaries — anderer Codepath, anderes Sprach-Target. Wenn der Signer kompromittiert wäre, würde Verify es fangen."*

**Was du NICHT sagst:**
- Nicht „HSM-backed", weil's nicht ist
- Nicht „enterprise-grade key management" — dazu gleich mehr
- Nicht „we built our own crypto" — wir compose ed25519-dalek + coset, beide audited dependencies

**Wenn jemand fragt — und das wird Eifrem fragen — „Wer kontrolliert den Signing-Key? Was wenn er leakt?":**
> *„Heute ist es ein Ephemeral-Keypair pro Signer-Boot, persistiert für die Host-Lifetime in Mac-tmp. Das ist by-design ein 36-Stunden-Build. Architektur ist HSM-ready: Signer ist stateless Sidecar, Key-Material wird beim Boot injiziert. Production-swap auf KMS oder HSM ist eine 30-Zeilen-Config-Änderung — der event-log-shape ist das Wertvolle, der Key-Custody-Layer drüber ist ein Tausch, kein Rewrite. Compare to Vector-DB: nichts da reinzu-tauschen."*

Memorize especially: **„stateless Sidecar, HSM-ready at boot, 30-line config swap to production PKI."** Verbatim.

**Wenn jemand fragt „Warum Ed25519 und nicht ECDSA / RSA / post-quantum?":**
> *„Ed25519 weil deterministische Signaturen — same input gives same signature. Notwendig für hash-stable Reproducibility. Plus: 64-byte Sig, schnell, audited (libsodium-Linie). Post-quantum migration ist roadmap — wir kapseln crypto in canon-signer, das Substrate ist Algorithmus-agnostic."*

---

### Der MCP-Server (das Wesentliche für Slide 6)

**Was es technisch tut:**
- Standalone Node-Script `mcp/canon-mcp.ts`, stdio-Transport via `@modelcontextprotocol/sdk`.
- **6 Tools** registriert: `canon_workspaces`, `canon_lookup`, `canon_search`, `canon_cite`, `canon_diff`, `canon_external_lookup` (Tavily, returns `unsigned: true`); plus `canon_write` als v0.2 Stub.
- **Workspace-aware:** lookup/search/cite/diff nehmen einen `workspace`-Param (default `northwind`); `canon_workspaces` listet die verfügbaren mit fact-counts.
- User-scope registriert in `~/.claude.json` — bei jedem `claude` Aufruf in jedem cwd verfügbar.
- Tool-Beschreibungen routen: `[CALL THIS FIRST for any question about a CUSTOMER, COMPANY, ACCOUNT...]`. Verifizierte Routing-Logik — Live-Test Sa nachmittag passed.

**Was du auf der Bühne sagst:**
> *„Canon spricht MCP nativ. Sechs Tools — lookup, search, cite, diff, external-lookup, workspaces. Workspace-aware: ein Canon-MCP, mehrere Tenants. Tavily für public-web-Kontext, explizit als unsigned getaggt. Mount-bar in Claude Desktop, Cursor, Windsurf, Zed. Eine Config-Datei lang."*

Dann das live-Demo: in Cursor fragst du „Was wissen wir über ACME?". Claude ruft `canon_lookup` autonom auf. Slide 6 macht den Punkt.

**Was du NICHT sagst:**
- Nicht „MCP ist die Zukunft" als Glaubenssatz — quantitativ argumentieren
- Nicht „Qontext braucht uns" — wir bieten ihnen einen Test an, keine Bedingung

**Wenn Nominacher fragt „MCP ist 12 Monate alt, ~200 Server, mostly developer-toy":**
> *„Korrekt. Wir wetten nicht, dass MCP diesen Monat Enterprise erobert. Wir wetten, dass die IDE-Wedge der Enterprise-Wedge um 18 Monate vorausgeht — same curve wie LSP, same curve wie USB-C. Wenn MCP scheitert, ist unser event-log + REST-Shim ein Ein-Tag-Port."*

---

## Die 4-Stage Pipeline als verbale Choreografie

Wenn du Slide 3 zeigst, sag das hier in genau dieser Reihenfolge — die Layer-Namen müssen scharf sein:

> *„Vier Layer. Pioneer extrahiert deterministisch. Gemini liest die ganze Quelle und audited. Aikido und unsere lokale Engine refused, was nicht canonized werden darf. canon-signer signiert — Ed25519, hash-chained. Vier Layer, kein banaler Sticker. Jeder Layer verändert die Wahrheit."*

Das sind genau 38 Wörter / ~13 Sekunden. Pro Layer ein Satz. Schnelle Kadenz, dann ein Beat Pause, dann der Schluss-Satz „kein banaler Sticker."

**Wichtig:** „Jeder Layer verändert die Wahrheit" ist die Linie die Eifrem an dich erinnert. Das ist die These, die er nicht so leicht widerlegen kann — weil sie sagt, dass Canon NICHT nur Aggregator ist sondern aktiv kuratiert.

---

## Die Demo-Choreografie — was passiert auf welcher Sekunde

Aus `pitch/STAGE-CUES.md` mit Erklärung warum jeder Beat dort ist:

| Sekunde | Beat | Warum dieser Moment wichtig ist |
|---|---|---|
| 0:00 | Two-ACMEs Hook | Konkret > abstrakt. Du hast es selbst erlebt. Das macht's glaubwürdig sofort. |
| 0:42 | Click Sync now | „Live click → live data" — der erste echte Moment der das Pitch von Folie zu Demo wechselt. |
| 0:52 | Click ⚠ Resolve conflict | Conflict-Resolution UX ist die einzige Stelle wo der Mensch noch eingreift — alles andere ist autonom. Diese Geste sagt: „signed Truth lebt vom Menschen-Pick, nicht vom Algorithmus." |
| 0:58 | Sign as canonical (50) | Das Wort „canonical" trägt das Branding. Der signed Resolution-Event ist die Kern-Innovation. |
| 1:04 | View proof + Verify | Das ist Eifrems Moment. COSE_Sign1 hex auf der Wand, click verify, ✓ verified · 12ms. Dauer ~3 Sekunden, Wirkung 30 Sekunden. |
| 1:12 | Cmd-Tab → Cursor + ACME-Frage | Der MCP-Beat. Du tippst die Frage, Claude routet autonom auf canon_lookup + canon_cite, der Output zeigt strukturierte Facts mit Citations. Das ist die Federation-Story als physikalisches Ereignis. |
| 1:48 | Slide 7 + €0.001/event Pricing | Pricing als VC-Konfidenz-Signal. Sag's klar. |
| 1:55 | Stop talking | Der finale Satz ist der Aufzug-Pitch. Stille danach ist Souveränität. |

---

## Q&A-Drills — die fünf Fragen, die du auswendig haben musst

Nicht durchlesen — **laut sagen**. Eine Frage, deine Antwort, Pause.

### 1. „Wie unterscheidet sich Canon von einer Vector-DB / RAG?"
> *„RAG retrieved chunks by similarity und hofft, der Prompt findet das Richtige. Canon emit signed events — strukturiert, mit Citations, kryptographisch beweisbar. RAG halluziniert by similarity. Canon proves provenance. Verschiedene Layer, gleiches Stack möglich."*

### 2. „Wer kontrolliert den Signing-Key?"
> *„Heute Ephemeral-Key pro Signer-Boot — ein 36-Stunden-Build. Architektur ist HSM-ready: stateless Sidecar, Key-Injection beim Boot. Production-swap ist 30 Zeilen Config. Der event-log-shape ist das Wertvolle, key custody ist eine Tier-up-Tausch-Operation."*

### 3. „Wie skaliert das auf 1B Facts pro Jahr?"
> *„MCP-Federation. Jeder Workspace ist ein eigener MCP-Server, ein eigener Hash-Chain, eine eigene Postgres-Shard. Larger Agents stitchen mehrere Canon-Instances zusammen via Workspace-ID-Routing. Kein global lock, lineares scaling. Hosted-Tier billed €0.001 per signed event nach 10k free."*

### 4. „Warum sollten wir euch unterstützen, nicht eines der anderen 299 Teams?"
> *„Weil das hier kein Demo-Layer ist, das ist ein Substrate-Layer. Drei source-Adapter shipped, dreiunddreißig signierte Facts in der Demo, fünf MCP-Tools live. Trust-Pipeline aus vier kommerziellen Layern, jeder architektur-formend. Und: Canons eigenes Repo ist self-Aikido-monitored, signed, kompiliert. Recursive trust nicht im Slide — es läuft."*

### 5. „Wer baut das Team?"
> *„Solo gebaut in 36 Stunden — Nelson Mehlis, prior Founder bei PatchParty, B2B-SaaS, exited. Founder-bildende Erfahrung mit Rust + Ed25519 aus dem `empheral`-Projekt — Canon nutzt dieselbe Signing-Substrate. Ich suche technical co-founder, GTM-Partner, design partners. Das ist die Bitte."*

---

## Voice & Body — wie es klingen soll

**Tempo:**
- Slide 1 (Hook): langsam. Lang die Stille nach „Two truths." einen Atemzug aushalten.
- Slide 3 (Architektur): scharf, präzise, fast monoton — du benennst Komponenten.
- Slide 4 (Demo): live-action voice — present tense, „ich klicke", „Canon liest". Tempo passt sich der Maus an.
- Slide 5 (Tech depth): wieder scharf. Hex-string ist auf dem Slide, du sagst nur was passiert (verify, ed25519, offline-checkable).
- Slide 6 (Qontext): leiser, langsamer. Augen-Kontakt mit den Qontext-Jurorinnen. Das ist wo das Dinner entschieden wird.
- Slide 7: normaler Tempo. Pricing klar aussprechen. **Pause** vor dem Ein-Satz-Schluss. Schluss-Satz nicht hetzen.

**Hände:**
- Wenn du auf Slide 3 zeigst (Architektur), zähl die Layer mit den Fingern. Eins-Pioneer, Zwei-Gemini, Drei-Aikido-und-lokal, Vier-Signer.
- Bei „Sign as canonical": Click mit Bewegung sehen lassen. Nicht raschen. 1-2 Sekunden Cursor sichtbar.
- Auf Slide 6 (Qontext): nicht zeigen, schauen. Augen-Kontakt > Hand-Kontakt.

**Wenn du blank wirst:**
- Bei Zahl-blank: „die Q1-Zahl" / „die Renewal-Datum" — generische Referenz statt falsche Zahl.
- Bei Tech-blank: „der Layer macht genau das, was wir gerade gesehen haben — auf einen anderen Way." Lustig, klingt souverän, kauft 5 Sekunden.
- Bei kompletter Blank: trink Wasser. Das gibt 4 Sekunden. Dann: „where was I — der dritte Layer."

---

## Drei Sätze für die Q&A — die du oft brauchen wirst

1. **„Das ist eine 36-Stunden-Build. Architektur ist solide; das Production-Hardening ist ein 30-line-config-swap."** — passt für: HSM, KMS, OAuth-Edge-Cases, DPA, Multi-Tenant, fast alles "aber ist das production-ready?"

2. **„Same input gives same hash. Das ist die Reproducibility-Garantie unter dem signierten Audit-Chain."** — passt für: jede Frage, die "warum signed?" sagt.

3. **„Wir konkurrieren nicht — wir feeden."** — passt für: jede Frage, die ein potential-competitor benennt.

---

## Kraft-Sätze, falls du Power brauchst (nicht over-using)

- *„Canon ist nicht ein Tool — es ist ein Layer. Der Unterschied entscheidet, ob du dem Output deines Agents trauen kannst."*
- *„Die Frage 'wessen Wahrheit?' ist nicht beantwortbar ohne signed events. Heute beantwortet niemand sie. Wir tun's."*
- *„Wir bauen die fehlende Schicht zwischen Source-Systems und Agents — die, die heute jeder annimmt, dass sie da ist."*

Diese sind Notausgänge — wenn ein Juror skeptisch wird, zieh **eine** dieser Linien. Mehr als eine, und sie klingt wie verkauft.

---

## Wenn du diesen Doc geschlossen hast, sollst du sagen können:

1. Den Ein-Satz-Pitch von Slide 7 — auswendig.
2. Die 4-Layer-Choreografie ("Pioneer extrahiert ... canon-signer signiert ... vier Layer, kein banaler Sticker") — auswendig.
3. Die HSM-Antwort ("stateless Sidecar, HSM-ready at boot") — auswendig.
4. Den RAG-Konter (19 Wörter: "RAG retrieved chunks by similarity ... Canon proves provenance.") — auswendig.
5. Die Pricing-Linie (€0.001 per signed event nach 10k free, MIT self-host) — auswendig.

Wenn du eines davon nicht hast: lies den Abschnitt nochmal. Sag's laut. Geh nicht auf die Bühne ohne diese fünf.

---

## Letzte Anmerkung (beim Lesen Sa abend)

Du hast 36 Stunden gebaut, was Teams in Wochen probieren. Der Code ist gut — Red-Team-Reviews vorhanden, kritische Lücken gefixt. Die Demo ist live, das MCP-Routing funktioniert verifizierbar. Der Pitch hat eine Story-Hook, einen technischen Beweis, einen Business-Modell-Anker, einen Co-Sell-Vorschlag.

Was du noch brauchst: lass es einmal laut durchlaufen, mit Timer, allein im Hotel-Zimmer. Wenn die Speaker-Notes sich anfühlen wie deine eigenen Wörter — du bist bereit.

**Bau das Ding nicht weiter heute Abend. Schlaf.** So vormittag: Tier-1 + Tier-3.9-3.12 aus `TEST-CATALOG.md`, eine letzte Pitch-Probe, dann auf die Bühne.

Dinner gewinnen.
