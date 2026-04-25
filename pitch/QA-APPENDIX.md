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
Workspace-State (Stand letzter Sync): **~50 active signed FactEvents, 6 customer entities, 5 Korroborationen, 5 live Konflikte.**

Pitch-Highlights:
- Northwind Q1 MRR: **€127.000**, bestätigt durch Slack + Gmail (3 facts).
- Q1 Forecast (Feb): €150.000 — corroborated von PDF + Slack, semantically superseded.
- ACME: 50 seats, Renewal 2026-05-15, ACV €120.000 (50 × €2,400/Jahr). Frühere Schätzung 40 seats — live conflict für User-Pick-Demo.
- TechCo: 12 seats × €200/Mo = €2,400 MRR lost. Confirmed by 3 sources.
- Globex (annual, 25 seats), Initech (monthly, 18 seats), Soylent (12-vs-14 seat ambiguity) — Tier-2 customers in der Demo.
- Q2 weighted Pipeline: €444.000 ARR.

### "Warum nur 3 Sources?"
Demo-Fokus. Architektur ist Source-Adapter-basiert. Slack, Gmail, PDF heute live; GitHub, Notion, Linear sind Issues im Repo mit gleichem `FactDraft`-Schema.

### "36 Stunden — was ist tatsächlich broken?"
1. OAuth-Flows sind happy-path only — Gmail 2FA-edge bricht.
2. `canon_write` MCP-Tool ist Stub (returnt explizit „v0.2 coming soon"). Lookup/search/cite/diff sind live.
3. Signing-Key ist ephemeral-pro-Host (siehe oben), nicht HSM-backed. Architektur-ready, swap pending.
4. Multi-Tenant-Federation ist im MCP-Tool-Naming angelegt (workspace-scoped), aber Single-User-DB im Demo.

### "Wer im Team baut das?"
Solo-built in 36 Stunden — Nelson Mehlis, prior Founder bei PatchParty (B2B-SaaS, exited). Founder-bildende Erfahrung mit signed-event-logs aus dem `empheral`-Projekt (Rust, Ed25519, COSE) — Canon nutzt dasselbe Signing-Substrate. Looking for: technical co-founder, GTM partner, design partners.

### "Why now — warum diese Woche?"
MCP shipped vor ~12 Monaten, ist jetzt in Claude Desktop, Cursor, Windsurf, Zed default. Agent-population wächst gerade durch die Schwelle, an der „mein Agent halluziniert" zu „mein Agent macht teure Aktionen auf falschen Facts" wird. Vor MCP gab es keine Distribution für signed-fact-source. Nach MCP gibt es eine, und sie ist 12 Monate alt — wir sind am Anfang der Adoptions-Kurve, nicht am Ende.

---

## Track-fit (Qontext jurors)

### "Sie haben gesagt, ihr feedet Qontext. Beweis?"
Canon-MCP-Server ist live, Claude-Desktop-Config liegt im Repo (`mcp/claude-desktop-config.example.json`). Selbe Config funktioniert in Qontexts Stack — wir hatten das mit Lorenz/Nikita am Booth abgesprochen. Ich gebe dir die Config heute Abend.

### "Warum sollten wir euch und nicht eines der anderen 299 Teams?"
Weil das hier kein Demo ist — das ist ein Layer. Drei Adapter shipped, zehn als Issues mit Tests. Trust-Pipeline aus vier Partnern, jeder architektur-formend, kein Sticker. Und: Canon's eigenes Repo ist self-Aikido-monitored, signed, beweisbar. Recursive trust ist nicht im Slide — es läuft.
