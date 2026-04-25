# Canon — Pre-Pitch Test Catalog

**Wann:** vor dem Pitch (Sa abends + So vormittags). Komplett-Run ~10 min.
**Pass-Kriterium:** alle Tier-1 grün. Tier-2 ist Bonus, Tier-3 sind Q&A-Landmines (mind. lesen, mental haben).

---

## Tier 1 — System health (3 min)

### 1. MCP server connected
```bash
claude mcp list | grep canon
```
**Erwartet:** `canon: npx tsx /Users/nelsonmehlis/Desktop/canon/mcp/canon-mcp.ts - ✓ Connected`
**Fail-fix:** `claude mcp add --scope user canon -- npx tsx /Users/nelsonmehlis/Desktop/canon/mcp/canon-mcp.ts`

### 2. Dev-server alive
```bash
curl -s --max-time 5 http://localhost:3000/ -o /dev/null -w "%{http_code}\n"
```
**Erwartet:** `200`
**Fail-fix:** `cd ~/Desktop/canon && npm run dev` in einem freien Terminal

### 3. DB has facts (sonst hast du nix zu zeigen)
```bash
cd ~/Desktop/canon && npx tsx -e "
import 'dotenv/config';
import { prisma } from './src/lib/prisma';
const u = await prisma.user.findFirst({orderBy:{createdAt:'desc'}});
const n = await prisma.factEvent.count({where:{userId:u!.id, status:'active'}});
console.log('active facts:', n);
await prisma.\$disconnect();
" 2>/dev/null
```
**Erwartet:** `active facts: 24-30` (≥20)
**Fail-fix:** im Browser auf /app gehen → **Sync now** klicken

### 4. Aikido reachable
```bash
cd ~/Desktop/canon && set -a && source .env.local && set +a && curl -sS -X POST https://app.aikido.dev/api/oauth/token -u "$AIKIDO_CLIENT_ID:$AIKIDO_CLIENT_SECRET" -d "grant_type=client_credentials" | grep -q access_token && echo OK
```
**Erwartet:** `OK`
**Fail-fix:** WLAN, sonst kein Aikido-Banner — Demo läuft trotzdem (Banner zeigt "offline")

---

## Tier 2 — Demo flow live (4 min)

### 5. Browser: /app rendert mit allen Sektionen
Open: `http://localhost:3000/app`
**Erwartet auf Screen:**
- Header: "Northwind Software · 24 facts · 3 sources · 1-2 conflicts need resolution"
- Aikido banner: `aikido · ThePyth0nKid / canonBigHackBerlin · 0 issues · 16:xx`
- 3 Sections: Northwind / ACME / TechCo
- Northwind.MRR mit `✓ 2 sources` Badge oder höher
- ACME.Seats mit `⚠ resolve` Badge

### 6. Sync now → Toast erscheint
Klick **Sync now** in der Header.
**Erwartet:**
- Button wird ~6s spinning
- Wird ~2s grün mit `✓ synced`
- Bottom-rechts Toast: `✓ Synced in X.Xs · 24 signed facts · 3 corroborated · 2 conflicts`
**Fail-fix:** wenn Toast Error: lies die Message, häufig „no Google account" → /login Google neu machen

### 7. Conflict resolve modal
Klick `⚠ resolve` neben ACME.Seats.
**Erwartet:**
- Side-by-side modal: zwei Spalten
- Linke Spalte: `50` mit slack+pdf pills, "3 facts"
- Rechte Spalte: `40` mit gmail pill, "2 facts"
- "pick as truth" Buttons
- Klick auf 50 → modal closed → Page refresh → 40 verschwunden, 50 wird zur active value

### 8. View proof + Verify
Klick `view proof →` auf irgendeinem Fact (zB. €127,000 MRR).
**Erwartet:**
- Modal zeigt: Entity, Metric, Source, Excerpt, Observed, Signed at, signerPubkey, Parent hash, Event hash, COSE_Sign1 hex (block)
- Rechts oben: `verify` Button
- Klick `verify` → kurze Pause → `✓ verified · XXms` (typisch 8-30ms)
**Fail-fix:** wenn `✗ binary not found` → CANON_VERIFY_PATH stimmt nicht; check `ls /Users/nelsonmehlis/Desktop/empheral/reference/validator/target/release/canon-verify`

---

## Tier 3 — MCP via Claude Code (3 min)

> Beende vorher die laufende `claude` Session (`/exit`), dann `claude` neu — sonst lädt es die letzte Tool-Description.

### 9. Routing-Test 1 — Customer-Frage
Tippe in `claude`:
> *Was wissen wir über ACME mit kryptographischem Beweis?*

**Erwartet:** Claude ruft autonom `canon_lookup({entity:"acme"})` (NICHT grep). Dann `canon_cite` für proof. Output enthält:
- 50 seats, €120k ARR, Renewal 2026-05-15
- Konflikt 50 vs 40 surfaced
- COSE_Sign1 envelope, parentHash, eventHash, signerPubkey
**Fail-fix:** Tippe explizit „Ruf canon_lookup für ACME auf" — wenn das auch nicht klappt: `claude mcp list` checken

### 10. Routing-Test 2 — Metric-Frage
Tippe:
> *Was war unser Q1 MRR?*

**Erwartet:** Claude ruft `canon_search({query:"Q1 MRR"})` oder `canon_lookup({entity:"northwind"})`. Output: €127,000, korroboriert von 2-3 Quellen, mit factIds.

### 11. Routing-Test 3 — Diff-Frage
Tippe:
> *Was hat sich für TechCo seit dem 22. April geändert?*

**Erwartet:** Claude ruft `canon_diff({entity:"techco", since:"2026-04-22"})`. Listet die churn + seats events.

### 12. Counter-Test — sollte NICHT MCP nutzen
Tippe:
> *Was ist die Tariff-Tier-Klasse für ACME-Wildcard-Zertifikate?*

**Erwartet:** Claude geht zu file-search im empheral Repo, findet R8.F8 Spec. **NICHT** Canon — weil das eine Code-Frage ist, nicht eine Business-Frage. (Das beweist dass Claude wirklich routet, nicht blind alles zu Canon schickt.)

---

## Tier 4 — Q&A landmines (lies durch, mental haben)

Vom 14-DEMO-SHOW-EXPLAINED.md + Review-Pass:

| Frage | Antwort (kurz, deutsch) |
|---|---|
| **Wer signiert die Conflicts?** | „User-Pick wird selbst zu einem signierten ResolutionEvent — gleicher Ed25519-Key, gleiche Hash-Kette. Tamper-proof." (✓ ist im Code) |
| **Wie unterscheidet ihr euch von Qontext?** | „Canon = Layer 1, signed-fact-source. Qontext = Context-Layer der drauf reasoned. Wir konkurrieren nicht — wir feeden sie. Mount in 5 Min." |
| **Wie unterscheidet ihr euch von RAG / Langchain?** | „RAG sucht similarity, halluziniert. Canon proves provenance — jedes Fact signed, hash-chained, agent-verifiable offline." |
| **Können Agents das selbst verifizieren?** | „Ja. canon-verify-wasm, pubkey gepinnt, offline. Auf Stage gerade: live verify roundtrip ~10ms." |
| **Was wenn Pioneer halluziniert?** | „Layer 2 ist Gemini-2.5-flash auditor mit 2M-context. Liest die ganze Slack-Quelle, flagged Widersprüche. UI zeigt `⚠ audit` badge." |
| **Wie skaliert das?** | „MCP-Federation. Jeder Workspace ist ein MCP-Server, größere Agents stitchen sie zusammen. Heute: single workspace, demo-ready." |
| **Was wenn die Quelle hochsensitive Daten hat?** | „Layer 3 — local pattern engine plus Aikido. Detected secret/PII → refuse-to-sign, statt FactEvent kommt RedactionEvent (selbst signiert). Demo-bereit." |
| **Open-source Modell?** | „MIT, public repo `github.com/ThePyth0nKid/canonBigHackBerlin`, MCP-native. Ihr könnt's heute Abend forken und mounten." |
| **Was kommt als nächstes?** | „canon_write — Agents schreiben Facts zurück durch denselben scan→sign Pipeline. Plus Federation für multi-workspace. Plus Qontext-Integration als Design-Partner." |

---

## Stage-Run-Order (cheat sheet)

1. ✅ Tier 1 zwischen Submission und Pitch (system green)
2. ✅ Tier 2 letzter Walkthrough 30 min vor Pitch (UI verhält sich)
3. ✅ Tier 3 Test 9 ist der **Stage-Punch** — proben bis es 1× sauber durchläuft
4. ✅ Tier 4 lesen, dann nicht panisch werden wenn jemand fragt

**Wenn Tier 1.1 (MCP) fail't auf der Stage:** Fallback = `npx @modelcontextprotocol/inspector npx tsx mcp/canon-mcp.ts`. Browser-Tab geht auf, du klickst `canon_lookup` mit `entity: "acme"`. Gleiche Daten, andere UI. Pitch ist gerettet.
