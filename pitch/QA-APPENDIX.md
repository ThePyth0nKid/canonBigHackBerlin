# Canon — Q&A Appendix

One-page cheat sheet. Tight answers. Numbers from story-bible only.

---

## Architecture / cryptography

### "Wer signiert die Conflicts?"
Der User pickt die Auflösung — und der Pick selbst ist ein **ResolutionEvent**, signed mit derselben Ed25519-Chain wie jeder FactEvent. Der Resolver, der Zeitpunkt, die ausgewählte Quelle: alles im signierten Audit-Log. Live im Code: `src/app/app/_actions/resolve.ts`.

### "Wie genau signiert ihr?"
Ed25519, COSE_Sign1-Envelope, hash-chained: `eventHash = hash(parentHash || canonical(payload))`. Rust-Sidecar (`canon-signer`), 44/44 tests. Verify-Binary ist unabhängig — anderes Sprach-Target, anderer Codepath, no trust in Canon nötig.

### "Können Agents das selbst verifizieren?"
Ja. `canon-verify-wasm`, Pubkey gepinnt, offline. Agent ruft `canon.cite(factId)` → bekommt COSE-Envelope → verifiziert lokal. Kein Server-Round-Trip nötig für Trust.

### "Was wenn die Pioneer-Extraction halluziniert?"
Genau dafür Layer 2. Gemini 2M-context liest die volle Channel-/Inbox-/PDF-History und audited den Pioneer-Output gegen den weiteren Kontext. Widerspricht der Fact dem Kontext → er wird `PendingFact`, nicht signed. Bleibt der Konflikt: Conflict-UI, User-Pick, signed.

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
Northwind Q1 MRR: **€127.000**, bestätigt durch Slack + Gmail + Board-Deck-PDF.
Q1 Forecast (Feb): €150.000 — superseded.
ACME: 50 seats, Renewal 2026-05-15, ACV €120.000 (50 × €2,400/Jahr). Frühere Schätzung 40 seats — superseded by recency.
TechCo: 12 seats × €200/Mo = €2,400 MRR lost. Confirmed by 3 sources.
Q2 weighted Pipeline: €444.000 ARR.

### "Warum nur 3 Sources?"
Demo-Fokus. Architektur ist Source-Adapter-basiert. Slack, Gmail, PDF heute live; GitHub, Notion, Linear sind Issues im Repo mit gleichem `FactDraft`-Schema.

### "36 Stunden — was ist tatsächlich broken?"
1. OAuth-Flows sind happy-path only — Gmail 2FA-edge bricht.
2. Reconciliation-UI handled binary conflicts, nicht 3-way.
3. `canon.write` MCP-Tool ist Stub — Read-Tools sind alle live.

---

## Track-fit (Qontext jurors)

### "Sie haben gesagt, ihr feedet Qontext. Beweis?"
Canon-MCP-Server ist live, Claude-Desktop-Config liegt im Repo (`mcp/claude-desktop-config.example.json`). Selbe Config funktioniert in Qontexts Stack — wir hatten das mit Lorenz/Nikita am Booth abgesprochen. Ich gebe dir die Config heute Abend.

### "Warum sollten wir euch und nicht eines der anderen 299 Teams?"
Weil das hier kein Demo ist — das ist ein Layer. Drei Adapter shipped, zehn als Issues mit Tests. Trust-Pipeline aus vier Partnern, jeder architektur-formend, kein Sticker. Und: Canon's eigenes Repo ist self-Aikido-monitored, signed, beweisbar. Recursive trust ist nicht im Slide — es läuft.
