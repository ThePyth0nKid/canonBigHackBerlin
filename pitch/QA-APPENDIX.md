# Canon — Q&A Appendix

One-page cheat sheet. Tight answers. Numbers from story-bible only.

---

## Architecture / cryptography

### "Wer signiert die Conflicts?"
Der User pickt die Auflösung — und der Pick selbst ist ein **ResolutionEvent**, signed mit derselben Ed25519-Chain wie jeder FactEvent. Der Resolver, der Zeitpunkt, die ausgewählte Quelle: alles im signierten Audit-Log. Live im Code: `src/app/app/_actions/resolve.ts`.

### "Wie genau signiert ihr?"
Ed25519, COSE_Sign1-Envelope, hash-chained: `eventHash = hash(parentHash || canonical(payload))`. Rust-Sidecar (`canon-signer`), 44/44 tests. Verify-Binary ist ein **separates** Programm (`canon-verify`), anderer Codepath, no trust in der Signer-Pipeline nötig.

### "Wer kontrolliert den Signing-Key? Was wenn er leakt?"
Heute: ephemeral Ed25519-Keypair pro Signer-Boot, persistiert für die Host-Lifetime in `/var/folders/...` (Mac-tmp). **Das ist by-design ein 36h-Build, kein Production-PKI.** Architektur ist HSM-ready: Signer ist stateless Sidecar, Key-Material wird beim Boot injiziert. Production-swap ist eine 30-Zeilen-Config-Änderung — der event-log-shape ist das wertvolle, der Key-Custody-Layer drüber ist ein Tausch, kein Rewrite. Compare to Vector-DB: nichts da reinzu-tauschen.

### "Können Agents das selbst verifizieren?"
Ja. Live: `/api/verify` spawnt das `canon-verify`-Binary server-side, Roundtrip ~12ms. Architektur-target: WASM-Build des gleichen Crate für reine Browser-Side-Verification (Pubkey gepinnt, offline). Quelle der Verifikation ist die canon-verify Codebasis, **nicht** der canon-signer — separater Codepath, separates Sprach-Target.

### "Was wenn die Pioneer-Extraction halluziniert?"
Erstens: Pioneer ist **span-extractor** (GLiNER-2), kein Generator — jeder Output ist verbatim aus dem Source-Text. Halluzination im klassischen Sinne ist by construction nicht möglich. Zweitens: Layer 2 (Gemini 2M-context) liest die volle Channel-/Inbox-/PDF-History und audited den Pioneer-Output. Widerspruch im Kontext → Fact bekommt `notes='audit:contradiction:...'`, UI zeigt `audit·flag` Badge. Audit-Errors **fail closed** — Gemini-Blip = `audit_unavailable` Tag, nicht silent confirmed.

### "Pioneer fällt aus / wird teurer / pivoted. Plan?"
Pioneer ist Layer 1 — Span-Extractor mit FactDraft-Schema-Output. Schnittstelle ist 50 Zeilen Code (`src/lib/canon/pioneer.ts`). Drop-in-Replacements heute: GLiNER-2 self-host (Apache-2.0), oder kleines tuned-LLM mit JSON-mode. Lock-in ist nicht Pioneer das Modell, sondern das FactDraft-Contract — das ist unsers.

### "Was wenn Aikido einen False Positive flagt?"
RedactionEvent statt FactEvent — selbst signed. User kann override (auch das ein signed Event). Kein silent drop, kein silent sign.

### "Aikido auf eurem eigenen Repo — was hat es gefunden?"
Drei Findings, alle triaged: (1) **HIGH SAST path-traversal** in `src/lib/ingest/pdf.ts:27` — Aikido fand eine readFile-mit-User-Input-Stelle. Wir haben heute Nachmittag eine `safeResolveInsideDemo`-Whitelist eingebaut (CWE-23 mitigated, realpath plus root-prefix-check). (2) **LOW SAST NoSQL-injection-Pattern** in `src/app/app/_actions/resolve.ts` — Prisma escapes the inputs, Aikido auto-ignored. (3) **LOW SCA postcss CVE-2026-41305** — devDep, auto-ignored.

Das hier ist nicht „0 issues" als Marketing-Claim. **Drei gefunden, drei triaged, der HIGH ist gefixt.** Recursive trust working as designed.

---

## Positioning

### "Wie unterscheidet ihr euch von Qontext?"
Canon = Layer 1, signed-fact-source. Qontext = Context-Layer, der Canon konsumiert. Wir konkurrieren nicht — wir feeden. Mount Canon-MCP in Qontext: 5 Minuten Config. Pitch-Climax und Dinner-Move.

### "Wie unterscheidet ihr euch von RAG / LangChain?"
RAG retrieves chunks by Vector-Similarity und hofft, der Prompt findet das Richtige. Canon stores structured single-sentence Facts mit expliziten Citations und kryptographischer Provenance. **RAG halluziniert by similarity. Canon proves provenance.** LangChain ist Orchestration, Canon ist die Truth-Source darunter.

### "Mem0? Cognee?"
Mem0 ist Agent-Memory — ein Agent, ein Memory. Canon ist Cross-Agent, Cross-Source Truth-Layer. Cognee ist Chat-fokussiert. Canon hat **kein Chat-UI** — Canon ist Substrate, nicht Frontend.

### "Isn't this just a database?"
Postgres ist drin. Aber: Hash-Chain, Ed25519-Signing, MCP-Server, Conflict-Resolution-UI, Reproducible Pipeline — das ist nicht ein Schema, das ist ein Trust-Protokoll on top.

---

## Scaling / business

### "Wie skaliert das?"
**MCP-Federation.** Jeder Workspace ist ein eigener MCP-Server. Larger Agents stitchen mehrere Canon-Instances zusammen. Postgres skaliert linear; canon-signer ist stateless Sidecar; Hash-Chain ist per-workspace, kein global lock.

### "Was ist das Business-Modell?"
n8n-Modell. MIT-Core distribution; hosted Tier per-fact-event (€0.001 pro Event über 10k free). Enterprise self-host: SSO, Support. Per-event aligned mit Wert.

### "Privacy / data sovereignty?"
Nichts verlässt deine Infrastruktur. Self-hosted MCP-Server. Hosted Tier EU-only auf Railway Frankfurt. Source-Tokens AES-GCM at-rest. DPA-Template im Repo, nicht production-signed yet — honest known gap.

### "Why MCP and not LangChain tools?"
Weil jede ernsthafte IDE und jeder Coding-Agent in 2026 MCP spricht: Claude Code, Cursor, Windsurf, Zed. Das ist USB-C für Agent-Tools.

---

## Numbers / story (für Demo-Q&A)

### "Was sind die Zahlen?"
Workspace-State (Stand letzter Sync): **2 active workspaces, ~400 active signed FactEvents, ~50 RedactionEvents, ~110 entities.**

| Workspace | Active facts | Redacted | Entities | Notable |
|---|---|---|---|---|
| `northwind` (demo) | ~50 | 8 | 6 | ACME 50-vs-40 seats, €127k MRR 3-source corroboration |
| `inazuma` (Qontext dataset) | ~310 | 40 | 105 | 6 industry conflicts surfaced from clients.json/vendors.json directly |

Northwind pitch numbers:
- Q1 MRR: **€127.000**, bestätigt durch Slack + Gmail.
- Q1 Forecast (Feb): €150.000 — corroborated, semantically superseded.
- ACME: 50 seats, Renewal 2026-05-15, ACV €120k. Live conflict 50 vs 40.
- TechCo: 12 seats × €200/Mo = €2,400 MRR lost. 3 sources.
- Q2 weighted Pipeline: €444.000 ARR.

Inazuma pitch numbers:
- 400 B2B clients, 400 vendors, 1260 employees, 11.9k emails, 2.9k conversations, 10.8k internal Q&A in the dataset.
- 6 dataset-native industry conflicts (Miller Group, Gonzalez Inc, Johnson Group; Huang LLC, Williams Group, Martin Ltd).
- 40 PII redactions caught by Layer 3 in `contact_email` fields.

### "Warum nur 3 Sources?"
Demo-Fokus. Architektur ist Source-Adapter-basiert. Slack, Gmail, PDF heute live für Northwind. **Plus Qontext-Adapter für Inazuma — strukturierte JSON-Records (clients/vendors/employees/posts) gehen direct-to-FactDraft, free-form (emails/conversations) durch Pioneer.** Insgesamt: 5 source-paths heute, GitHub/Notion/Linear sind 50-line additions.

### "Wieso nicht eure Free-Form-Daten von Inazuma durch Pioneer? Pioneer extrahiert 0 drafts dort."
Honest gap: Pioneer's domain-aware post-processor (440 lines in `pioneer.ts`) ist auf den Northwind-Cast getunt. Für Inazuma's Cast (1260 employees, 400 clients) hätten wir die Canonicalization-Map dynamisch aus den JSON-Records ziehen müssen — das ist 30 Minuten work die wir bewusst nicht in 36 Stunden investiert haben. **Strukturierte JSON-Records gehen sowieso direct-to-FactDraft (deterministisch, hash-stabil) — Pioneer ist für free-form Text. Inazumas Emails laufen durch, Pioneer findet aber keine bekannten Entitäten und droppt sie.** Architectural gap, nicht implementation gap; 30 lines fixen es post-submission.

### "36 Stunden — was ist tatsächlich broken?"
1. OAuth-Flows sind happy-path only — Gmail 2FA-edge bricht.
2. `canon_write` MCP-Tool ist Stub (returnt explizit „v0.2 coming soon"). Lookup/search/cite/diff/external/workspaces sind live (6 Tools).
3. Signing-Key ist ephemeral-pro-Host (siehe oben), nicht HSM-backed. Architektur-ready, swap pending.
4. Per-workspace Sync ist heute nur für Northwind verkabelt — Inazuma ingest läuft via CLI (`scripts/ingest-qontext.ts`), nicht über den UI-Sync-Button. Workspace-routing in `/api/sync` ist eine 30-Zeilen-Erweiterung, queued für v0.2.

### "Wer im Team baut das?"
Solo-built in 36 Stunden — Nelson Mehlis, prior Founder bei PatchParty (B2B-SaaS, exited). Founder-bildende Erfahrung mit signed-event-logs aus dem `empheral`-Projekt (Rust, Ed25519, COSE) — Canon nutzt dasselbe Signing-Substrate. Looking for: technical co-founder, GTM partner, design partners.

### "Why now — warum diese Woche?"
MCP shipped vor ~12 Monaten, ist jetzt in Claude Desktop, Cursor, Windsurf, Zed default. Agent-population wächst gerade durch die Schwelle, an der „mein Agent halluziniert" zu „mein Agent macht teure Aktionen auf falschen Facts" wird. Vor MCP gab es keine Distribution für signed-fact-source. Nach MCP gibt es eine, und sie ist 12 Monate alt — wir sind am Anfang der Adoptions-Kurve, nicht am Ende.

---

## Track-fit (Qontext jurors)

### "Sie haben gesagt, ihr feedet Qontext. Beweis?"
Canon-MCP-Server ist live, Claude-Desktop-Config liegt im Repo (`mcp/claude-desktop-config.example.json`). Selbe Config funktioniert in Qontexts Stack — und weil wir euer Inazuma-Dataset bereits durch unsere Pipeline gepumpt haben, ist die Federation kein Versprechen sondern ein laufender Workspace: **`/app?ws=inazuma`** auf `canon.ultranova.io`. Mount canon-MCP in Qontext: 5 Minuten Config. Selbe Tools, neuer workspace param, eure Daten signed.

### "Ihr habt unser Dataset benutzt — habt ihr nur unsere bekannten Duplikate gezeigt?"
Honest answer: ja teilweise. Der Sample-Algorithm in `qontext.ts` priorisiert deterministisch jene `business_name`s die in clients.json mehrfach oder in clients UND vendors auftauchen — sechs Stück. Plus 30 weitere zufällig deterministisch gesampelte clients/vendors. **Wir haben die Konflikte nicht erfunden, wir haben sie zuverlässig in den Demo-Sample gezogen.** Ohne diese Force-Inclusion würde ein 40-zufälliger Sample mit ~7% Chance einen Konflikt enthalten — wir wollen aber dass er reproduzierbar drin ist, jeden Run, für die Demo. Same auto-resolution-policy fired auf den anderen ~250 sampled records — diese landen als active signed facts ohne Konflikt.

### "Wie ist die hash-chain-Story bei zwei Workspaces?"
Per-workspace Hash-Chain. Northwind und Inazuma sind unabhängige chains, jede anchort am eigenen genesis (parentHash leer). Das ist by-design, nicht Schwäche — selbe Logik wie multi-tenant Postgres-rows in zwei Schemas. Cross-workspace-Order ist keine property, die wir claimen. Innerhalb eines workspaces: jeder Fact zeigt mit parentHash auf den vorhergehenden, tamper-evident. Für Federation: zwei tenants, zwei chains, beide live in einem Canon.

### "Warum sollten wir euch und nicht eines der anderen 299 Teams?"
Weil das hier kein Demo ist — das ist ein Layer. Drei Adapter shipped, zehn als Issues mit Tests. Trust-Pipeline aus vier Partnern, jeder architektur-formend, kein Sticker. Und: Canon's eigenes Repo ist self-Aikido-monitored, signed, beweisbar. Recursive trust ist nicht im Slide — es läuft.
