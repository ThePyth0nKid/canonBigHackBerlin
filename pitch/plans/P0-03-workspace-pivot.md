# P0-03 — Workspace pivot: Northwind out, single Inazuma view

**Owner**: code agent
**ETA**: 45min (code + DB delete + smoke)
**Blocks**: P1-06 (pitch docs sync depends on this being landed)

---

## Goal

Move Canon to a **single-workspace UI** (`inazuma`). Northwind's role disappears; the synthetic Slack/Gmail/PDF data that used to live in `workspace='northwind'` either gets deleted or re-targeted into `inazuma`. Story changes from "two workspaces side-by-side" to "drop your enterprise data + connect your channels = one canonized view."

## Why now

- User decision Sat 22:00: pivot away from "two parallel workspaces"
- D1 in GAMEPLAN — single workspace UI
- D2 in GAMEPLAN — delete northwind rows
- D3 in GAMEPLAN — sync route writes to inazuma

## Context to read first

- [`pitch/context/SYSTEM.md`](../context/SYSTEM.md)
- [`pitch/context/DATABASE.md`](../context/DATABASE.md) — workspace concept + how queries filter
- [`src/lib/canon/view.ts`](../../src/lib/canon/view.ts) — WORKSPACES constant + loadFactLandscape
- [`src/app/app/page.tsx`](../../src/app/app/page.tsx) — workspace switcher rendering
- [`src/app/api/sync/route.ts`](../../src/app/api/sync/route.ts) — what currently writes 'northwind'

## Constraints

- **Don't drop the `workspace` column** — schema stays, just one default value
- **Existing `inazuma` rows untouched** (those are the demo state from P0-01)
- **Don't break MCP** — MCP tools accept `workspace` param defaulting to inazuma

## Step-by-step

### 1. Delete Northwind rows from prod (5min)

```bash
npx tsx -e "
import { prisma } from '@/lib/prisma';
(async () => {
  const r = await prisma.factEvent.deleteMany({ where: { workspace: 'northwind' } });
  console.log('Deleted', r.count, 'northwind rows');
  await prisma.\$disconnect();
})();
"
```

Expect ~89 rows deleted.

### 2. UI changes (~20min)

**`src/lib/canon/view.ts`** — shrink WORKSPACES constant:
```ts
export const WORKSPACES = [
  { slug: 'inazuma', label: 'Inazuma.co', description: 'Your business · canonized' },
] as const;
```

Keep `loadFactLandscape` as-is — it accepts a workspace param.

**`src/app/app/page.tsx`**:
- Default `wsParam = 'inazuma'` (not `'all'`)
- Remove WorkspaceSwitcher rendering entirely
- Remove `workspaceTitle()` branching — always "Inazuma.co" or "Your business · canonized"
- Remove the `INAZUMA_DEMO_GOLD` vs `NORTHWIND_FEATURED` branching in Landscape()
- The 'all' view branching → drop entirely
- `uploadTarget()` returns `'inazuma'` always

**`src/app/app/_components/workspace-switcher.tsx`** — leave file, it just won't be imported anymore. Or delete if you want clean.

### 3. Sync route → inazuma workspace (~10min)

**`src/app/api/sync/route.ts`**:
- Remove the `?ws=` rejection for non-northwind workspaces
- Default workspace param → `'inazuma'`
- Remove workspace=='northwind' filter on the `deleteMany` (sync's reset behavior)

```ts
// at top of POST handler
const workspace = 'inazuma';
// (remove ?ws= rejection block)

// in reset path
await prisma.factEvent.deleteMany({
  where: { userId, workspace, sourceRef: { startsWith: 'slack:' } },
});
// (Slack/Gmail/PDF synthetic only — don't touch dataset facts)
```

The reset must NOT wipe Qontext-sourced facts. Filter by `sourceRef LIKE 'slack:%' OR 'gmail:%' OR 'pdf:%'` only — the synthetic stuff.

### 4. SyncButton text + label (~5min)

**`src/app/app/_components/sync-button.tsx`**:
- Old: "Sync now"
- New: "+ Slack +Gmail +PDF" (or three small pills if you can pull off the layout fast — single button is fine for now)

### 5. Smoke (~5min)

- /app loads, no switcher, only inazuma view, ~3000 facts
- Click sync button → adds Slack/Gmail/PDF synthetic rows into inazuma workspace
- Source pills now show 5+ kinds in one view: qontext, slack, gmail, pdf, plus uploads later

## Acceptance criteria

- `prisma.factEvent.count({ where: { workspace: 'northwind' } })` returns 0
- /app shows no workspace tabs / no switcher
- Sync button adds synthetic data into the same view
- Conflicts surface across qontext + slack/gmail (e.g. clients.json says Miller Group industry=Manufacturing, Slack message in synthetic data says Entertainment → conflict on entity miller_group, metric industry)

## Files to touch

- `src/lib/canon/view.ts` — WORKSPACES shrink
- `src/app/app/page.tsx` — switcher remove, default 'inazuma'
- `src/app/api/sync/route.ts` — workspace = inazuma, reset scope by sourceRef
- `src/app/app/_components/sync-button.tsx` — label
- `src/app/app/_components/workspace-switcher.tsx` — DELETE FILE (or leave unused)

## Risk

- **MCP `canon_workspaces` tool** lists workspaces — will now return only `[{slug:'inazuma'}]`. Fine, just less interesting. Update MCP tool description copy if needed.
- **Sync existing tests/snapshots** — none rely on `workspace='northwind'` strings (verified earlier).

## Hand-off agent

Use `general-purpose` agent. Brief in [`pitch/agents/BRIEFS.md`](../agents/BRIEFS.md#p0-03).
