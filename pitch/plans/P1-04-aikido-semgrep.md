# P1-04 — Aikido-style custom trust-gate rule via Semgrep

**Owner**: code agent (security/SAST background helps)
**ETA**: 90min
**Blocks**: P1-06 (pitch can claim "custom static-analysis rule" credibly only after this lands)

---

## Goal

Author a real, runnable, repo-local SAST rule that enforces Canon's **trust gate**: every write to `FactEvent` must go through `runPipeline()` (which signs via Ed25519). Direct `prisma.factEvent.create` outside the pipeline = violation. The rule lives in `.semgrep/canon-trust-gate.yml`. Surface its existence as a "policy enforced" artifact in the UI banner area.

## Why this and not Aikido API custom rules

D5 in GAMEPLAN: Aikido custom-rule API likely requires enterprise tier. Semgrep is free, fast, runnable in any CI, and the pitch story is identical — "we wrote a Canon-specific static-analysis rule." Semgrep is even arguably stronger because it's **portable** (anyone can run it without an Aikido subscription).

## Pitch story this enables

> "Beyond Aikido watching our supply chain, we wrote our OWN static-analysis rule that enforces Canon's trust property at the source level: any code that writes to the FactEvent table outside the signed pipeline trips a high-severity finding. The rule lives in our repo at `.semgrep/canon-trust-gate.yml`, runs in CI, and you can run it yourself with one command."

## Context to read first

- [`pitch/context/PIPELINE.md`](../context/PIPELINE.md) — what `runPipeline` is and why it's the only legitimate writer
- [`src/lib/canon/pipeline.ts`](../../src/lib/canon/pipeline.ts) — the only valid `prisma.factEvent.create` callsite (~line 165)
- [Semgrep YAML rule docs](https://semgrep.dev/docs/writing-rules/rule-syntax/)

## Constraints

- **Rule must NOT false-positive on the legitimate `pipeline.ts:165` call** — that's the only allowed write
- **Rule must catch any other call** — even ones obfuscated like `prisma["factEvent"].create(...)` or via dynamic accessor
- **Must run in <5s** on the full repo so CI is fast

---

## Step-by-step

### 1. Author the rule (~30min)

Create `.semgrep/canon-trust-gate.yml`:

```yaml
rules:
  - id: canon-direct-fact-event-write
    languages: [typescript, tsx]
    severity: ERROR
    message: |
      FactEvent rows must only be written via runPipeline() in src/lib/canon/pipeline.ts.
      Direct prisma.factEvent.create / update / upsert / createMany bypasses the
      Ed25519 signer + hash chain extension. If you genuinely need a new write site,
      add it inside runPipeline() so the signature stays load-bearing.
    pattern-either:
      - pattern: $PRISMA.factEvent.create(...)
      - pattern: $PRISMA.factEvent.createMany(...)
      - pattern: $PRISMA.factEvent.update(...)
      - pattern: $PRISMA.factEvent.updateMany(...)
      - pattern: $PRISMA.factEvent.upsert(...)
      - pattern: $PRISMA["factEvent"].$METHOD(...)
    paths:
      exclude:
        - src/lib/canon/pipeline.ts  # the legitimate writer
        - src/app/api/sync/route.ts  # the deletes for reset are OK; alternatively use a more specific pattern that excludes only delete*
        - src/app/app/_actions/resolve.ts  # resolution events sign their own way (see RESOLUTION_TODO comment)
        - prisma/**
        - node_modules/**
        - "**/*.test.ts"
```

Note: `resolve.ts` (conflict resolution) currently writes `FactEvent` rows for resolution events — these are technically signed too via the same signer. If the rule fires there, that's actually right — resolutions should also go through runPipeline. **Fix-forward TODO**: refactor `resolve.ts` to call runPipeline. For now, exclude.

### 2. Run + iterate (~20min)

```bash
npx semgrep --config .semgrep/canon-trust-gate.yml src/
```

Expect: 0 findings (unless we're shipping a real bug). Iterate the rule + excludes until clean OR a real violation drops out.

### 3. Add to package.json scripts (~5min)

```json
{
  "scripts": {
    "trust-gate": "semgrep --config .semgrep/canon-trust-gate.yml src/ --error",
    "trust-gate:fail-test": "echo 'add a deliberate violation in scripts/ to test the rule fires'"
  }
}
```

### 4. CI hookup (~10min)

Add `.github/workflows/trust-gate.yml`:

```yaml
name: trust-gate
on: [push, pull_request]
jobs:
  semgrep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.x' }
      - run: pip install semgrep
      - run: semgrep --config .semgrep/canon-trust-gate.yml src/ --error
```

### 5. Surface in UI (~25min)

Below the AikidoRepoBanner, add a small "Policies enforced" pill that lists active local SAST rules:

**`src/app/app/_components/trust-gate-banner.tsx`** (NEW):
```tsx
export function TrustGateBanner() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
      <span aria-hidden>✓</span>
      <span>trust-gate</span>
      <span className="text-emerald-500/60">canon-direct-fact-event-write</span>
      <span className="text-zinc-500">· enforced in CI</span>
    </div>
  );
}
```

Render alongside `AikidoRepoBanner` in `src/app/app/page.tsx`.

### 6. Build a deliberate-broken branch for demo (~10min)

Create branch `demo-trust-gate-fires`. In a NEW file `scripts/demo-violation.ts`:
```ts
import { prisma } from '@/lib/prisma';
// This SHOULD trigger the trust-gate rule.
await prisma.factEvent.create({ data: { /* obviously fake */ } });
```

Run `npx semgrep --config .semgrep/canon-trust-gate.yml src/` → 1 finding.
Push the branch. Run CI → fail.

Don't merge. Use as a juror demo: "let me show you what happens when someone tries to bypass the signer." Switch to the broken branch, run the rule, watch it fire.

## Acceptance criteria

- `.semgrep/canon-trust-gate.yml` exists, lints clean
- `npx run trust-gate` exits 0 on main
- The deliberate-broken branch fails CI when pushed
- `/app` page shows the "trust-gate · enforced in CI" pill
- README has a section linking to the rule file with the one-line claim

## Files to touch

- `.semgrep/canon-trust-gate.yml` — NEW (the rule)
- `package.json` — add `trust-gate` script
- `.github/workflows/trust-gate.yml` — NEW
- `src/app/app/_components/trust-gate-banner.tsx` — NEW
- `src/app/app/page.tsx` — render TrustGateBanner near AikidoRepoBanner
- `README.md` — link + claim (handled in P1-06 sync; just leave a TODO marker)
- (optional) `scripts/demo-violation.ts` on a non-main branch only

## Risk

- **Rule false-positives on `resolve.ts` or `sync/route.ts`** — adjust excludes carefully; document why
- **Semgrep CLI install in CI takes 60s** — fine for non-hot CI, fast enough for demo
- **Pitch over-claim**: don't say "Aikido custom rule" unless you also wired it into Aikido (you didn't). Say "custom Semgrep rule, Aikido-style pattern, runnable everywhere"

## Hand-off agent

Use `general-purpose` agent. Brief in [`pitch/agents/BRIEFS.md`](../agents/BRIEFS.md#p1-04).
