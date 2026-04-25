# P2-07 — Robust live UI upload (only if time permits)

**Owner**: code agent
**ETA**: 90min
**Blocks**: nothing (true bonus)

---

## Goal

Make the live `/api/ingest-upload` SSE endpoint survive large drops (hundreds of files / tens of thousands of chunks) so the demo's drag-drop flow is reliable beyond single small files.

## Why P2 not P0

User decision (D11 in GAMEPLAN.md): demo flow is **pre-loaded data + one small live file drop**. The 306-folder mass upload is not the demo path. This work tightens robustness for jurors who poke beyond the scripted demo, not for the core flow.

## Scope

Refactor `src/app/api/ingest-upload/route.ts` from "parse all → extract all → sign all → conflict" to **streaming pipeline**:

1. **Sign direct drafts FIRST** (typed mappers like `clientToDrafts` — fast, no Pioneer needed) — these land in DB within ~60s even for 306-folder
2. **Pioneer chunks in micro-batches with concurrency 4 + retry/timeout/skip per batch**
3. **Each successful Pioneer batch's drafts get signed immediately** — no "wait for full extract"
4. **Failure isolation**: a single Pioneer batch timeout/error logs + skips, doesn't kill pipeline
5. **Conflict pass once at end** — same as today

### Architecture sketch

```
parse all files → directDrafts[] + chunks[]

[Phase 1: sign direct drafts]
runPipeline({ drafts: directDrafts, signer, workspace })

[Phase 2: incremental extract+sign]
const CHUNKS_PER_BATCH = 16
const CONCURRENCY = 4
chunked = chunks in groups of CHUNKS_PER_BATCH * CONCURRENCY
for slot in chunked:
  drafts = await Promise.all(slot.batches.map(batch =>
    timeout(60s, retry(2, () => extractFactsFromChunks(batch)))
      .catch(e => { log; return [] })
  )).flat()
  if drafts.length > 0:
    await runPipeline({ drafts, signer, workspace })  // chain extends
  emit progress event

[Phase 3: conflict pass]
resolveUserConflicts(userId, workspace)
```

The signer is shared across all `runPipeline` calls — pipeline.ts already supports `input.signer` reuse.

## Constraints

- **Don't deploy during a running prod ingest** (D6 in GAMEPLAN)
- **Keep the existing route's behavior** when only a small file drops — don't regress single-file demo flow
- **No DB schema changes** — pure orchestration refactor

## Step-by-step

### 1. Add `splitArrayBatched()` helper (~10min)

Tiny utility:
```ts
function batchedArray<T>(arr: T[], batchSize: number, concurrency: number): T[][][] {
  // Returns slot[batches[items]] grouping for slot-level parallelism
  const slotSize = batchSize * concurrency;
  const slots: T[][][] = [];
  for (let i = 0; i < arr.length; i += slotSize) {
    const slot = arr.slice(i, i + slotSize);
    const batches: T[][] = [];
    for (let j = 0; j < slot.length; j += batchSize) {
      batches.push(slot.slice(j, j + batchSize));
    }
    slots.push(batches);
  }
  return slots;
}
```

### 2. Add `withTimeoutRetry()` wrapper (~10min)

```ts
async function withTimeoutRetry<T>(
  fn: () => Promise<T>,
  { timeoutMs, retries }: { timeoutMs: number; retries: number },
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}
```

### 3. Refactor route handler (~50min)

In `src/app/api/ingest-upload/route.ts`, after the parse phase:

```ts
const signer = new CanonSigner();
signer.start();
let totalSigned = 0;

try {
  // Phase 1 — direct drafts
  if (allDirectDrafts.length > 0) {
    send({ phase: 'sign', message: `Signing ${allDirectDrafts.length} direct drafts...`, done: 0, total: allDirectDrafts.length });
    const r = await runPipeline({ userId, drafts: allDirectDrafts, signer, skipAudit, workspace, context: '', contextLabel: 'direct-drafts', onProgress: forwardSign });
    totalSigned += r.active + r.redacted + r.superseded;
  }

  // Phase 2 — chunks in slots
  if (allChunks.length > 0) {
    const slots = batchedArray(allChunks, 16, 4);
    let chunksDone = 0;
    for (const [slotIdx, slot] of slots.entries()) {
      const draftsArrays = await Promise.all(
        slot.map((batch) =>
          withTimeoutRetry(
            () => extractFactsFromChunks(batch),
            { timeoutMs: 60_000, retries: 1 },
          ).catch((e) => {
            console.warn(`[ingest-upload] batch slot=${slotIdx} failed:`, e.message);
            return [];
          }),
        ),
      );
      const drafts = draftsArrays.flat();
      chunksDone += slot.reduce((s, b) => s + b.length, 0);
      send({ phase: 'extract', done: chunksDone, total: allChunks.length });

      if (drafts.length > 0) {
        const r = await runPipeline({ userId, drafts, signer, skipAudit, workspace, context: '', contextLabel: `slot-${slotIdx}`, onProgress: forwardSign });
        totalSigned += r.active + r.redacted + r.superseded;
      }
    }
  }

  // Phase 3 — conflicts
  send({ phase: 'conflict' });
  const conflicts = await resolveUserConflicts(userId, workspace);
  // ... done event
} finally {
  await signer.close();
}
```

### 4. Update SSE done event aggregator (~10min)

Sum `active`/`redacted`/`superseded` across all `runPipeline` calls into the final `data` payload.

### 5. Smoke test (~10min)

- Upload 5 small files → all 5 signed sequentially in <30s
- Upload Qontext folder (306 files) → directly signed drafts land in DB <2min, Pioneer continues background
- Kill Pioneer mid-run (`PIONEER_BASE_URL=http://localhost:0`) → batches fail+skip, log warns, pipeline continues, conflict pass runs

## Acceptance criteria

- 306-folder upload signed direct drafts (~2000) within 2 min, no Pioneer needed
- Pioneer outage during run = pipeline continues, partial results persist
- Single-file upload still works in <30s same as today

## Files to touch

- `src/app/api/ingest-upload/route.ts` — main refactor
- `scripts/upload-stress-test.ts` — NEW, optional smoke

## Risk

- **Memory pressure** with 88k chunks + concurrency 4 = ~64 chunks in flight per slot. Should fit in 512MB heap. Verify on Railway.
- **Signer reuse across calls** — pipeline.ts must respect `input.signer` and not double-close. Verify by reading.

## Hand-off agent

Use `general-purpose`. Only start AFTER P0+P1 done and user signals. Brief in [`pitch/agents/BRIEFS.md`](../agents/BRIEFS.md#p2-07).
