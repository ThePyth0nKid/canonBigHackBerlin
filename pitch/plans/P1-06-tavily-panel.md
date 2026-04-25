# P1-06 — Tavily external-context panel in /app

**Owner**: code agent (UI + light backend)
**ETA**: 90min
**Blocks**: P1-07 (README + pitch can claim "Tavily integrated end-to-end" credibly only after this lands)

---

## Goal

Surface Tavily web search **in the /app UI** so the demo and the casual jury observer both see it in action. Currently Tavily is only callable via MCP (terminal-side) — for the live pitch and the recorded Loom this is invisible. Add an "external context" panel per entity that fetches Tavily on demand, renders top 3 results with the `unsigned: true` badge prominently, and shows Tavily's synthesis paragraph when provided.

**The pitch story this unlocks:**

> "Canon signs your facts. Tavily fetches the world's hearsay about the same entity. We display them side-by-side, in the same UI, with the trust gradient explicit — your truth is sealed; the web's view is unsigned. Agents and humans see the difference at a glance."

This converts Tavily from "auxiliary MCP tool nobody clicks during the demo" → "third partner integration visibly load-bearing in the demo flow."

---

## Why now

- BBH manual requires ≥3 partner integrations from {Pioneer, Gemini/DeepMind, Tavily, Lovable, Gradium}. We have 4 (Pioneer, Gemini, Tavily, Aikido) but Tavily is the weakest demo-side.
- Architect's recommendation pattern: "make integrations demonstrably live" (same pattern as P1-05 Gemini visibility).
- Validator finding: Tavily is wired (`tavily.ts` + MCP) but UI gap means jurors who don't open a terminal miss it entirely.

## Why this rather than other Tavily expansions

Three Tavily options were considered:
1. **UI panel per entity (this plan)** — visible during demo, ~90min
2. **Pre-canonization enrichment** — Tavily lookup before signing, attach to source body for Gemini audit. Adds latency to every sign, costs API quota, marginal demo value, ~3h
3. **Cross-check signal** — surface "Tavily disagrees" as soft signal next to canonical value. Cool but design-ambiguous (what does it mean to disagree with `unsigned`?), ~2h

Option 1 has the best impact-to-time ratio + cleanest pitch story. Options 2-3 are P3 stretch territory.

---

## Context to read first

- [`pitch/context/SYSTEM.md`](../context/SYSTEM.md) — module map (Tavily already wired)
- [`pitch/context/UI.md`](../context/UI.md) — component conventions, source-pill colors
- [`src/lib/canon/tavily.ts`](../../src/lib/canon/tavily.ts) — existing client (verify shape, don't refactor)
- [`mcp/canon-mcp.ts`](../../mcp/canon-mcp.ts) — see how `canon_external_lookup` formats results (reuse same field semantics)
- [`scripts/test-tavily.ts`](../../scripts/test-tavily.ts) — existing smoke

## What's already wired (don't redo)

- `src/lib/canon/tavily.ts` — full Tavily client, returns `ExternalContextResult` with `items: ExternalContextItem[]` carrying `unsigned: true`, `source: 'tavily-web'`, plus optional `synthesis` paragraph
- Env: `TAVILY_API_KEY` already set in `.env`
- MCP tool `canon_external_lookup` works
- Output shape includes `relevance` (0..1 from Tavily score) and `publishedAt`

## Constraints

- **Tavily API key MUST stay server-side** — do not expose in client code
- **Don't change the `tavily.ts` client surface** — backend stable, just wrap in route handler
- **Don't sign Tavily results** — they remain `unsigned: true` forever (architectural invariant)
- **Tavily quota awareness** — free tier has caps; cache server-side for 5min per query to avoid hammering during demo
- **Don't auto-fetch on page load** — lazy expand-to-fetch only, so /app stays fast for the 99% case where users don't expand

## Step-by-step

### 1. Server route `/api/external-lookup` (~25min)

Create `src/app/api/external-lookup/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { searchExternal } from '@/lib/canon/tavily';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Module-scoped cache: query → (result, expiresAt). 5min TTL.
const cache = new Map<string, { result: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_PER_USER_PER_MIN = 12;
const userLastCalls = new Map<string, number[]>();

export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Light rate limit per user (in-memory; demo-grade)
  const now = Date.now();
  const recent = (userLastCalls.get(userId) ?? []).filter(
    (t) => now - t < 60_000,
  );
  if (recent.length >= RATE_LIMIT_PER_USER_PER_MIN) {
    return NextResponse.json(
      { error: 'rate limited (12 lookups/min)' },
      { status: 429 },
    );
  }
  recent.push(now);
  userLastCalls.set(userId, recent);

  const url = new URL(req.url);
  const query = url.searchParams.get('q')?.trim() ?? '';
  if (!query || query.length < 2 || query.length > 240) {
    return NextResponse.json(
      { error: 'q must be 2..240 chars' },
      { status: 400 },
    );
  }

  // Cache hit?
  const hit = cache.get(query);
  if (hit && hit.expiresAt > now) {
    return NextResponse.json({ ...hit.result, cached: true });
  }

  try {
    const result = await searchExternal(query, {
      maxResults: 5,
      searchDepth: 'basic',
    });
    cache.set(query, { result, expiresAt: now + CACHE_TTL_MS });
    return NextResponse.json({ ...result, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? 'tavily error' },
      { status: 502 },
    );
  }
}
```

### 2. Client component `<ExternalContextPanel>` (~35min)

Create `src/app/app/_components/external-context-panel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

interface Item {
  unsigned: true;
  source: 'tavily-web';
  title: string;
  url: string;
  excerpt: string;
  relevance?: number;
  publishedAt?: string;
}

interface Result {
  query: string;
  items: Item[];
  synthesis?: string;
  fetchedAt: string;
  latencyMs: number;
  cached?: boolean;
}

interface Props {
  /** Display name to show as the search target (e.g. "Miller Group") */
  displayName: string;
  /** Optional pre-formed search query. Defaults to displayName. */
  query?: string;
}

export function ExternalContextPanel({ displayName, query }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const fetchTavily = () => {
    if (data || pending) return;
    setError(null);
    start(async () => {
      try {
        const q = (query ?? displayName).trim();
        const res = await fetch(
          `/api/external-lookup?q=${encodeURIComponent(q)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch { /* fallthrough */ }
          throw new Error(msg);
        }
        const json = (await res.json()) as Result;
        setData(json);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <details
      className="mt-3 group rounded-lg border border-sky-200 bg-sky-50/50 dark:border-sky-700/40 dark:bg-sky-950/20"
      onToggle={(e) => {
        const isOpen = (e.target as HTMLDetailsElement).open;
        setOpen(isOpen);
        if (isOpen) fetchTavily();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-sky-900 dark:text-sky-300">
        <span className="flex items-center gap-2">
          <span aria-hidden className="select-none transition-transform group-open:rotate-90">
            ›
          </span>
          🌐 external · search the web for {displayName}
        </span>
        <span className="rounded-full border border-sky-400 bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-900 dark:border-sky-500 dark:bg-sky-900/40 dark:text-sky-100">
          unsigned
        </span>
      </summary>

      {open && (
        <div className="border-t border-sky-200 p-4 dark:border-sky-800/40">
          {pending && (
            <p className="text-sm text-sky-700 dark:text-sky-300">
              Querying Tavily…
            </p>
          )}
          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400">
              ✗ {error}
            </p>
          )}
          {data && data.synthesis && (
            <blockquote className="mb-3 border-l-2 border-sky-400 pl-3 text-sm italic text-sky-900 dark:text-sky-100">
              "{data.synthesis}"
              <p className="mt-1 not-italic text-[10px] font-mono uppercase tracking-wider text-sky-700 dark:text-sky-400">
                Tavily synthesis · {data.latencyMs}ms
                {data.cached ? ' · cached' : ''}
              </p>
            </blockquote>
          )}
          {data && data.items.length === 0 && (
            <p className="text-sm text-zinc-500">
              No external context for this entity right now.
            </p>
          )}
          {data && data.items.length > 0 && (
            <ul className="space-y-3">
              {data.items.slice(0, 3).map((it) => (
                <li key={it.url}>
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm font-medium text-sky-900 hover:underline dark:text-sky-100"
                  >
                    {it.title}
                  </a>
                  <p className="mt-0.5 text-xs text-zinc-700 dark:text-zinc-300">
                    {it.excerpt}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-sky-600 dark:text-sky-400">
                    <span>{new URL(it.url).hostname}</span>
                    {it.relevance !== undefined && (
                      <span>· relevance {it.relevance.toFixed(2)}</span>
                    )}
                    {it.publishedAt && <span>· {it.publishedAt.slice(0, 10)}</span>}
                    <span className="rounded border border-sky-400 bg-sky-100 px-1 py-0.5 text-[9px] uppercase tracking-wider text-sky-900 dark:border-sky-500 dark:bg-sky-900/40 dark:text-sky-100">
                      unsigned
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}
```

### 3. Wire into EntitySection (~15min)

In `src/app/app/page.tsx`, inside `EntitySection`, render the panel after the metric grid:

```tsx
function EntitySection({ entity, primary }: ...) {
  return (
    <section>
      {/* existing header + metric rows */}
      <div className="mt-3 divide-y ...">
        {/* metrics */}
      </div>

      {/* NEW: external context */}
      <ExternalContextPanel
        displayName={entity.displayName}
        query={`${entity.displayName} company news`}
      />
    </section>
  );
}
```

Add the import at top of page.tsx.

### 4. Optional polish: source-pill addition (~5min)

If `src/app/app/_components/source-pill.tsx` doesn't already render `tavily-web` distinctly, add:

```ts
case 'tavily':
  return { label: 'Tavily', color: 'sky', symbol: '🌐' };
```

(But Tavily items don't appear as FactEvent rows — only as ExternalContextPanel content — so this is mostly defensive.)

### 5. Smoke test (~10min)

- Open canon.ultranova.io/app, scroll to any entity (e.g. Miller Group)
- Click the "🌐 external" disclosure
- Should fetch within 3s, render 1-3 results with title + excerpt + URL + "unsigned" badge
- Tavily synthesis (if present) renders as blockquote
- Click result link → opens source URL in new tab
- Click disclosure again → closes (data cached, no refetch on next open)
- Open a different entity → fresh fetch (different query)
- Spam-click 13+ entities in 60s → 13th gets `429 rate limited` error gracefully

## Acceptance criteria

- `/api/external-lookup?q=Miller+Group` returns 200 with `{items: [...], synthesis?: ...}` and items carry `unsigned: true`
- /app entity panel expand → renders top 3 web results in <3s
- "unsigned" badge visible on EVERY external item
- Demo path: open Miller Group entity → expand external context → contrast canonical signed facts (above) with web context (below) — visible trust gradient
- TAVILY_API_KEY never appears in client bundle (`grep TAVILY_API_KEY .next/static/` returns nothing)
- Existing MCP tool `canon_external_lookup` still works (regression smoke: `claude` → `canon_external_lookup({query:"Miller Group"})`)

## Files to touch

- `src/app/api/external-lookup/route.ts` — NEW
- `src/app/app/_components/external-context-panel.tsx` — NEW
- `src/app/app/page.tsx` — render panel inside EntitySection
- `src/app/app/_components/source-pill.tsx` — defensive case (optional)

## Risk

- **Tavily quota burn during demo rehearsal**: cache helps, but rehearsing 50 entity-clicks chews through quota. Use the same 3-5 entities consistently.
- **Tavily API down on demo day**: error renders gracefully ("Tavily unreachable"), but lose the demo beat. Mitigation: pre-warm cache for the 3 entities used in pitch by clicking them once before pitch starts.
- **Latency >5s on poorly-worded queries**: use `searchDepth: 'basic'` (already default) — caps at ~3s typical
- **Entity displayName is sometimes lowercase slug** (e.g. "miller_group" instead of "Miller Group") — verify `entity.displayName` resolves to the human form via `ENTITY_DISPLAY` map in view.ts

## Hand-off agent

Use `general-purpose`. Brief in [`pitch/agents/BRIEFS.md`](../agents/BRIEFS.md#p1-06).

Critical: agent should NOT modify `src/lib/canon/tavily.ts` — backend is stable. Only wraps it in a route handler.
