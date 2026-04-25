# P1-05 — Gemini reasoning surfaced in proof modal

**Owner**: code agent (UI + audit-flow comfort)
**ETA**: 90min
**Blocks**: P1-06 (pitch claims about Gemini get strongly defensible only after this)

---

## Goal

Make Gemini's audit verdict **visible per fact** in the proof modal. Right now Gemini's verdict only flips status to `superseded` and writes a 240-char truncated reason into `notes`. The user/jury can't see Gemini's confidence, can't see the cited contradiction quote in context, can't tell which model produced the verdict.

Architect's high-ROI pick (see GAMEPLAN.md). Converts Gemini from "blackbox claim" to "cited verdict."

## Why now

- Validator confirmed Gemini is the **load-bearing** integration (changes outcomes). It deserves prominent UI.
- Pitch claim "Gemini cited reasons, not blackboxes" needs visible proof.
- Architect estimated this at 2h with infrastructure already wired.

## Context to read first

- [`pitch/context/PIPELINE.md`](../context/PIPELINE.md) — audit + decide flow
- [`src/lib/canon/audit.ts`](../../src/lib/canon/audit.ts) — verdict shape
- [`src/lib/canon/pipeline.ts`](../../src/lib/canon/pipeline.ts) — where verdict gets persisted (notes column)
- [`src/app/app/_components/proof-modal.tsx`](../../src/app/app/_components/proof-modal.tsx) — current UI

## Constraints

- **No DB schema migration** — pack verdict JSON inside the existing `notes: string?` column. Format: `audit:{json}` so old rows with `audit:reason-text` still parse via fallback.
- **Backward compat**: existing FactEvent rows persisted with old format must still render (they just won't show new fields)
- **Don't change AuditVerdict shape** — pipeline contract is stable

## Step-by-step

### 1. Persist richer verdict in `notes` (~25min)

In `src/lib/canon/pipeline.ts` `decide()`:

```ts
function decide(scan, verdict, opts: { skipAudit: boolean }): { status, notes? } {
  if (!scan.cleared) {
    return { status: 'redacted', notes: `redaction:${scan.redactionReason}` };
  }
  
  // Pack verdict so UI can render confidence + citation
  const verdictPayload = JSON.stringify({
    confirmed: verdict.confirmed,
    confidence: verdict.confidence,
    contradiction: verdict.contradiction?.slice(0, 400),
    quote: verdict.contradictionQuote?.slice(0, 240),  // NEW
    model: 'gemini-2.5-flash',
    timestamp: Date.now(),
    skipped: opts.skipAudit,
  });
  
  if (verdict.contradiction === 'audit_unavailable') {
    return { status: 'active', notes: `audit:offline:${verdictPayload}` };
  }
  if (opts.skipAudit) {
    return { status: 'active', notes: `audit:skipped:${verdictPayload}` };
  }
  if (!verdict.confirmed && verdict.contradiction) {
    return { status: 'superseded', notes: `audit:flagged:${verdictPayload}` };
  }
  return { status: 'active', notes: `audit:confirmed:${verdictPayload}` };
}
```

**Format convention**: `audit:<status>:<json>` so a parser can split on `:` once and JSON.parse the rest. Old rows like `audit:reason-text-no-json` get parsed as `{ status:'<unknown>', message:rest }` fallback.

### 2. Add helper to parse notes (~10min)

`src/lib/canon/audit-notes.ts` (NEW):

```ts
export interface AuditNoteParsed {
  kind: 'confirmed' | 'flagged' | 'offline' | 'skipped' | 'redaction' | 'unknown';
  confirmed?: boolean;
  confidence?: number;
  contradiction?: string;
  quote?: string;
  model?: string;
  legacy?: string;
}

export function parseAuditNotes(notes: string | null | undefined): AuditNoteParsed {
  if (!notes) return { kind: 'unknown' };
  if (notes.startsWith('redaction:')) return { kind: 'redaction', legacy: notes.slice(10) };
  if (notes.startsWith('audit:')) {
    const rest = notes.slice(6);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) return { kind: 'unknown', legacy: notes };
    const kind = rest.slice(0, colonIdx);
    const payload = rest.slice(colonIdx + 1);
    try {
      const parsed = JSON.parse(payload);
      return {
        kind: kind as AuditNoteParsed['kind'],
        ...parsed,
      };
    } catch {
      // Old rows: payload was raw text not JSON
      return { kind: kind as AuditNoteParsed['kind'], legacy: payload };
    }
  }
  return { kind: 'unknown', legacy: notes };
}
```

### 3. Update audit.ts to capture quote (~15min)

If Gemini's verdict response can include a quote/span, extract it. Otherwise reuse `contradiction` as both reason + quote. Bump `responseSchema` to include `contradictionQuote`:

```ts
const VERDICT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    confirmed: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    contradiction: { type: 'STRING', description: 'Why the draft is contradicted' },
    contradictionQuote: { type: 'STRING', description: 'Verbatim substring from source body that contradicts the draft' },
  },
  required: ['confirmed', 'confidence'],
};
```

System prompt update — instruct Gemini to populate `contradictionQuote` with verbatim source-body substring when contradicting.

### 4. Update proof modal (~30min)

`src/app/app/_components/proof-modal.tsx` — add an "AUDIT" section after the eventHash + COSE block:

```tsx
const audit = parseAuditNotes(fact.notes);

{audit.kind !== 'unknown' && (
  <section className="mt-6">
    <h3 className="text-xs font-mono uppercase tracking-wider text-zinc-500">
      Audit · Layer 2
    </h3>
    <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-700/50 dark:bg-sky-950/30">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-xs uppercase tracking-wide text-sky-900 dark:text-sky-200">
          {audit.kind}
        </span>
        {audit.confidence !== undefined && (
          <span className="font-mono text-[11px] text-sky-700 dark:text-sky-400">
            confidence {audit.confidence.toFixed(2)}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">{audit.model ?? 'gemini-2.5-flash'}</p>
      {audit.contradiction && (
        <p className="mt-2 text-sm text-sky-900 dark:text-sky-100">
          {audit.contradiction}
        </p>
      )}
      {audit.quote && (
        <blockquote className="mt-2 border-l-2 border-sky-400 pl-3 text-sm italic text-sky-800 dark:text-sky-200">
          "{audit.quote}"
        </blockquote>
      )}
      {audit.legacy && (
        <p className="mt-2 font-mono text-[11px] text-zinc-500">{audit.legacy}</p>
      )}
    </div>
  </section>
)}
```

### 5. Add badge in MetricRow eyebrow (~10min)

`src/app/app/page.tsx` MetricRow — show Gemini's verdict signal alongside the existing audit-flag:

- `audit:flagged` → existing amber `audit·flag` (already there)
- `audit:offline` → grey `audit·offline` (NEW for sub-fix 2)
- `audit:skipped` → amber `⚠ unaudited` (NEW for sub-fix 3)
- `audit:confirmed` with confidence ≥0.8 → optional small green `gemini ✓` pill (only if metric.corroborated == false to avoid clutter)

## Acceptance criteria

- Click any signed fact → proof modal opens → AUDIT section renders model + confidence + reason
- A fact persisted with old `notes='audit:reason-text'` format still renders (legacy field shows)
- A `superseded` fact (contradiction case) shows the cited quote in italic blockquote
- An `audit:offline` fact shows the kind chip + no contradiction text
- Browser console: no errors when modal opens

## Files to touch

- `src/lib/canon/audit.ts` — schema bump + system prompt
- `src/lib/canon/pipeline.ts` — decide() pack verdict in notes
- `src/lib/canon/audit-notes.ts` — NEW parser
- `src/app/app/_components/proof-modal.tsx` — render AUDIT section
- `src/app/app/page.tsx` — MetricRow eyebrow signals (extend existing audit-flag logic)

## Risk

- **Verdict JSON balloons `notes` column** — keep payload <800 chars by truncating quote+contradiction
- **Old rows breaking** — `parseAuditNotes` has legacy fallback; test with seeded old-format row
- **Gemini ignores `contradictionQuote` field** — fine, just renders without quote section

## Hand-off agent

Use `general-purpose`. Brief in [`pitch/agents/BRIEFS.md`](../agents/BRIEFS.md#p1-05).
