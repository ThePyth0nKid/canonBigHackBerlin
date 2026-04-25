# P0-01 — Bulk-reload Qontext dataset into prod DB

**Owner**: human runs script · agent verifies
**ETA**: 30min (script run) + 5min (verify)
**Blocks**: nothing — but P0-03 expects the reloaded data to be in `inazuma` workspace

---

## Goal

Get the full Qontext starter dataset (~3000+ signed FactEvents, multiple sources, demo-gold conflicts surfaced) into the production database under `workspace='inazuma'`. Use the existing proven path — the live UI upload is too unreliable and isn't the demo flow.

## Why now

- The live UI upload at /api/ingest-upload broke once on the 306-folder case (88054 chunks → no facts persisted). User decided not to spend more time on that path.
- All other P0/P1 work assumes prod DB is in a known good state with ~3000 inazuma facts.
- This is the only thing blocking the rest of P0+P1.

## Context to read first

- [`pitch/context/SYSTEM.md`](../context/SYSTEM.md) — overall architecture
- [`pitch/context/DATABASE.md`](../context/DATABASE.md) — schema + workspace concept + how to query prod
- [`pitch/context/PIPELINE.md`](../context/PIPELINE.md) — sign loop, hash chain, audit gates
- [`scripts/ingest-qontext.ts`](../../scripts/ingest-qontext.ts) — the script we'll run

## Constraints

- **Run from local machine** with `DATABASE_URL` pointing at Railway prod (already set in .env)
- **Workspace = `inazuma`** (script defaults to this since pipeline.ts default; verify in script)
- **Do not delete northwind facts here** — that's P0-03's job. Just reload inazuma.
- **Do NOT deploy code during the run** — D6 in GAMEPLAN.

## Step-by-step

1. **Stop any in-flight ingest run.**
   - If `ps aux | grep tsx` shows `scripts/ingest-qontext.ts` running, let it finish OR kill cleanly with Ctrl-C.
   - If a Railway prod /api/ingest-upload request is still running (check railway logs for stale `[ingest-upload]` markers), accept it's dead — Railway's edge proxy timeout already killed it.

2. **Clear inazuma chain** (optional — script supports `--reset` flag).
   ```bash
   # From repo root
   npx tsx scripts/ingest-qontext.ts --reset --no-audit
   ```
   - `--reset` deletes existing `workspace='inazuma'` rows for current user before reloading
   - `--no-audit` skips Gemini calls (faster + no Vertex quota burn) — audit story is told via P1-05 anyway, the demo facts don't need to all be Gemini-vetted

3. **Watch progress.** Script logs phase boundaries; should land:
   - ~400 client drafts → ~2000 facts after typed mapping
   - ~400 vendor drafts → ~2000 facts
   - ~90 customer drafts → ~90 facts
   - ~60 employee drafts → ~60 facts
   - ~30 emails + 30 conversations → ~50-100 chunks → Pioneer extracts ~50 drafts → ~50 facts
   - ~30 posts → ~30 loose facts
   - ~40 IT tickets → ~80 facts
   - ~8 policies → ~50-200 chunks → Pioneer → ~50 drafts
   - **Total target**: ~3000-5000 facts

4. **Verify in DB.**
   ```bash
   npx tsx -e "
   import { prisma } from '@/lib/prisma';
   (async () => {
     const counts = await prisma.factEvent.groupBy({
       by: ['workspace', 'status'],
       _count: { _all: true },
     });
     console.table(counts);
     await prisma.\$disconnect();
   })();
   "
   ```
   Expect rows like:
   - `inazuma · active · ~3000`
   - `inazuma · superseded · 0-50` (some auto-resolved)
   - `inazuma · redacted · 0-20`
   - `northwind · active · ~89` (still there until P0-03 runs)

5. **Smoke test the unified view.**
   - Open canon.ultranova.io/app (default = 'all' until P0-03; for now should show union)
   - Confirm ≥3000 facts visible
   - Confirm at least one conflict (Miller Group, Gonzalez Inc, Johnson Group, or Huang/Williams/Martin dual-role) surfaces

## Acceptance criteria

- `prisma.factEvent.count({ where: { workspace: 'inazuma', status: 'active' } })` returns ≥3000
- `/app` view loads in <2s and renders the inazuma facts
- At least one `MetricRow` has `data-conflict-anchor=""` attr (= unresolved conflict needs human decision)
- No `console.error` in browser when navigating /app

## Files to touch

- None (uses existing scripts). Verification queries don't modify code.

## Risk

- **Script failure on Pioneer rate-limit**: rerun with `--no-audit --no-pioneer-policies` (skips PDF policies which generate the most chunks)
- **Vertex auth fail with --audit**: drop the `--audit` flag, run `--no-audit` instead. Story still works.
- **DB connection lag**: script logs every 100 facts; if it hangs, kill and rerun

## Hand-off agent

Not really an agent task — human runs script, agent verifies. If you want to delegate, give a `general-purpose` agent the verification queries (step 4-5) only, not the script run itself.
