# Context — UI conventions

**Read this BEFORE editing /app components or styling.**

---

## Tech stack

- Next.js 16.x App Router (React Server Components default)
- TailwindCSS for styling (utility-first, no custom CSS files)
- Auth.js v5 (NextAuth) — session via Google OAuth
- Server-Sent Events for live ingest progress (`fetch` + `ReadableStream` reader, no native EventSource — POST friendly)

## Layout philosophy

- Mono-spaced fonts for hashes, IDs, technical labels
- Sans-serif for prose / values
- High-contrast emerald = signed/active, amber = needs-decision, rose = error/redacted, sky = audit/info
- Use Suspense at every async boundary so the shell streams instantly

## Key components (post-pivot)

| Component | Purpose | File |
|---|---|---|
| WorkspacePage | /app entry, header + landscape | `src/app/app/page.tsx` |
| LandscapeBody | Async streamed entity grid | `src/app/app/page.tsx` (inline) |
| LandscapeSkeleton | Suspense fallback | `src/app/app/page.tsx` (inline) |
| EntitySection | One entity card with metric rows | `src/app/app/page.tsx` (inline) |
| MetricRow | One metric value + sources + actions | `src/app/app/page.tsx` (inline) |
| SourcePill | Visual badge for slack/gmail/pdf/qontext/upload/tavily | `src/app/app/_components/source-pill.tsx` |
| AikidoRepoBanner | Live triage strip | `src/app/app/_components/aikido-banner.tsx` |
| TrustGateBanner (P1-04) | Semgrep rule pill | `src/app/app/_components/trust-gate-banner.tsx` (NEW) |
| FileDropIngest | Drag-drop zone + SSE consumer | `src/app/app/_components/file-drop-ingest.tsx` |
| SyncButton | Triggers /api/sync (Slack/Gmail/PDF synthetic) | `src/app/app/_components/sync-button.tsx` |
| ConflictResolve | Modal: canonical + distinct modes | `src/app/app/_components/conflict-resolve.tsx` |
| ProofModal | eventHash + COSE bytes + audit reasoning (P1-05) | `src/app/app/_components/proof-modal.tsx` |
| WorkspaceSwitcher | DELETED in P0-03 (single workspace) | (was `workspace-switcher.tsx`) |

## Suspense streaming pattern

`page.tsx` shell renders synchronously (header, drop zone, sync button, banners). The big async work — `loadFactLandscape()` — sits inside a `<Suspense fallback={<LandscapeSkeleton />}>`. Switching workspaces (or refreshing after sync) shows the skeleton instantly while the new data streams in.

```tsx
<Suspense key={workspace} fallback={<LandscapeSkeleton workspace={workspace} />}>
  <LandscapeBody userId={userId} workspace={workspace} />
</Suspense>
```

## SSE pattern (file-drop-ingest)

```ts
const res = await fetch('/api/ingest-upload', { method: 'POST', body: fd });
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf('\n\n')) !== -1) {
    const chunk = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 2);
    if (!chunk.startsWith('data: ')) continue;
    const event = JSON.parse(chunk.slice(6));
    // dispatch
  }
}
```

Phases: `init → parse → extract → sign → conflict → done` (or `error`).

## Style conventions

- `font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500` — eyebrow labels
- `text-3xl font-semibold tracking-tight tabular-nums` — hero values
- `rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950` — cards
- `divide-y divide-zinc-200 dark:divide-zinc-800` — list separators
- Status-tinted backgrounds: `bg-emerald-50 dark:bg-emerald-950/30`, `bg-amber-50 dark:bg-amber-950/30`, etc.

## Anti-patterns

- ❌ Loading data in client components — SSR everything that doesn't need interactivity
- ❌ Putting big async waits outside Suspense — page LCP suffers
- ❌ Custom CSS files — Tailwind only
- ❌ `useState` for data that lives in URL — use `searchParams` instead

## When changing /app

1. Read the page.tsx structure top to bottom
2. Check what's inside the Suspense vs outside (shell vs body)
3. Don't break the data-conflict-anchor selector (FileDropIngest scrolls to it)
4. Test in both light + dark mode
