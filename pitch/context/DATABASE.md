# Context — Database (Postgres + Prisma)

**Read this BEFORE writing DB queries or modifying schema.**

---

## Provider

- Postgres on Railway (managed)
- `DATABASE_URL` in local `.env` points at the prod database (we develop against prod for the demo)
- Prisma 6.x ORM
- Schema: `prisma/schema.prisma`

## Schema (post-pivot, single workspace)

```prisma
model FactEvent {
  id            String    @id              // f_<20-char-base32>
  userId        String                     // session.user.id (Google OAuth)
  workspace     String    @default("inazuma")
  entity        String                     // slug, e.g. "miller_group"
  claim         String                     // free text or "<redacted>"
  metricKey     String?                    // e.g. "monthly_revenue"
  metricValue   String?                    // verbatim from source, e.g. "3990000"
  metricUnit    String?                    // optional, e.g. "€" or "%"
  sourceRef     String                     // e.g. "qontext:client:abc-def" or "slack:C0:1234.5#s2"
  sourceExcerpt String?                    // 1-2 lines verbatim, "<redacted>" if PII-flagged
  parentHash    String?                    // sha256 of previous event in chain (per workspace per user)
  eventHash     String                     // sha256 of (id, claim, sourceRef, parentHash, signedAt, ...)
  coseSign1Hex  String                     // COSE_Sign1 serialization, hex-encoded
  signerPubkey  String                     // ed25519 pubkey hex
  signedAt      DateTime                   // exact sign time
  observedAt    DateTime?                  // when source asserted
  createdAt     DateTime  @default(now())
  status        String                     // "active" | "redacted" | "superseded" | "resolution"
  notes         String?                    // "audit:<kind>:<json>" after P1-05; legacy raw text before

  @@index([userId, workspace])
  @@index([userId, workspace, entity])
  @@index([userId, workspace, signedAt])
}
```

## The hash chain

- One chain per `(userId, workspace)` tuple
- Genesis: `parentHash = ''` (empty string)
- Subsequent events: `parentHash = previous event's eventHash`
- Tail lookup: `findFirst({ where: { userId, workspace }, orderBy: { createdAt: desc } })`
- `pipeline.ts` does this in `fetchTailEventHash()`

**Why per-workspace**: multi-tenant federation without cross-workspace order leak. Different customers' chains stay independent even on shared db.

## Status values

| Status | Meaning | When |
|---|---|---|
| `active` | Live, canonical, queryable | Default for new signed facts |
| `redacted` | PII/secret detected, original dropped | local scan refused |
| `superseded` | Older / contradicted | Either Gemini contradicted, or human resolved conflict canonical pick |
| `resolution` | Signed event recording a human decision (canonical or distinct) | UI conflict-resolve action |

## Notes column conventions

The `notes` column carries audit + redaction trail:

- `redaction:<reason>` — local scan refused. e.g. `redaction:secret:openai_api_key`
- `audit:confirmed:<json>` — Gemini said yes (P1-05+)
- `audit:flagged:<json>` — Gemini said contradicted, status=superseded (P1-05+)
- `audit:offline:<json>` — Gemini unreachable, status stays active (P0-02+)
- `audit:skipped:<json>` — `skipAudit:true` was passed, status active (P0-02+)
- `resolution:canonical:winner=<id>;losers=<ids>` — human resolution event
- `resolution:distinct:candidates=<ids>` — human "they're independent" event

Legacy rows (pre-P1-05) carry `audit:<reason-text>` without JSON. The `parseAuditNotes()` helper handles both.

## sourceRef conventions

Stable, idempotent, prefix indicates origin:

- `qontext:client:<client_id>` — Qontext clients.json record
- `qontext:vendor:<client_id>` — Qontext vendors.json record
- `qontext:customer:<customer_id>`
- `qontext:employee:<index>`
- `qontext:email:<email_id>`
- `qontext:conversation:<conv_id>`
- `qontext:post:<author>:<title-slug>`
- `qontext:it_ticket:<id>:<role>` (raised | assigned)
- `qontext:policy:<filename-slug>#p<page>`
- `slack:<channel>:<ts>#s<idx>` — synthetic Slack message
- `gmail:<msg-id>:<idx>` — synthetic Gmail
- `pdf:<filename>:p<page>` — synthetic Q1 board deck
- `upload:<filename-slug>:<row-id>` — user-uploaded record
- `tavily:<url-hash>` — external search result (NEVER signed)

## Common query patterns

### Count by workspace+status
```ts
await prisma.factEvent.groupBy({
  by: ['workspace', 'status'],
  where: { userId },
  _count: { _all: true },
});
```

### Get tail of chain
```ts
await prisma.factEvent.findFirst({
  where: { userId, workspace },
  orderBy: { createdAt: 'desc' },
  select: { eventHash: true },
});
```

### Replay chain (for verify)
```ts
await prisma.factEvent.findMany({
  where: { userId, workspace },
  orderBy: { signedAt: 'asc' },
});
// Then walk: each row's parentHash must equal prev row's eventHash
```

### Conflict-detection materialized view
None — conflicts.ts computes on-demand from active rows. Acceptable for ~10k row scale.

## Prod state quick-check

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

## When NOT to migrate

- It's after midnight
- Pitch is in <12h
- The change can be packed into an existing `notes` column

When YES to migrate (carefully):
- Adding a clearly missing column with default that won't break existing reads
- Schema diff is simple, `prisma migrate dev` runs clean locally first
- You have time to rollback if Railway rejects

## Local-vs-prod discipline

Both share `DATABASE_URL`. Therefore:
- **Don't `prisma migrate reset`** — wipes prod
- **Don't `prisma db push --force-reset`** — wipes prod
- Use `prisma migrate dev --name x` against a separate `DATABASE_URL_LOCAL` if you must, then commit, then `prisma migrate deploy` against prod
- Until then, schema-stable changes only
