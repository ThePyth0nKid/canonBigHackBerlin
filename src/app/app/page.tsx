import { Suspense } from 'react';
import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import {
  loadEntitiesBySlugs,
  loadEntitySlugsOrdered,
  loadFactStats,
  loadSourceStatuses,
  WORKSPACES,
} from '@/lib/canon/view';
import { AikidoRepoBanner } from './_components/aikido-banner';
import { TrustGateBanner } from './_components/trust-gate-banner';
import { SyncButton } from './_components/sync-button';
import { FileDropIngest } from './_components/file-drop-ingest';
import { EntitySection } from './_components/entity-section';
import { TailLoader } from './_components/tail-loader';
import { ConnectedSources } from './_components/connected-sources';
import { AskCanon } from './_components/ask-canon';

export const dynamic = 'force-dynamic';

/**
 * Inazuma "demo gold" + Northwind cast — these always render server-side
 * on first paint. Everything else is paginated through TailLoader to
 * keep TTFB under 200ms on a 2200-entity ledger.
 */
const FEATURED_SLUGS = [
  'inazuma',
  'miller_group', 'gonzalez_inc', 'johnson_group',
  'huang_llc', 'williams_group', 'martin_ltd',
  'northwind', 'acme', 'techco', 'globex', 'initech', 'umbrella', 'soylent',
];

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id?: string }).id;
  if (!userId) redirect('/login');

  const activeWorkspace = 'inazuma';
  const wsMeta = WORKSPACES[0];

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">
                Your business · canonized
              </h1>
              <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-sky-700 dark:text-sky-400">
                signed ledger
              </span>
            </div>
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/' });
              }}
            >
              <button
                type="submit"
                className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
              >
                Sign out
              </button>
            </form>
          </div>

          {/* Ask-Canon hero — sits directly under the H1 because the
              audience asks "what can I do here?" first; everything below
              this line is supporting context (sync controls, banners,
              source list, file drop). */}
          <AskCanon />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
              {wsMeta.description}
            </span>
            <SyncButton />
          </div>

          {/* Connected sources panel: Suspense so it doesn't gate the
              header on the per-source recency probes. */}
          <Suspense fallback={null}>
            <ConnectedSourcesRow userId={userId} workspace={activeWorkspace} />
          </Suspense>

          <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-900">
            <AikidoRepoBanner />
            <TrustGateBanner />
          </div>

          <FileDropIngest workspace="inazuma" />
        </header>

        {/* Stats: groupBy queries — fast (<200ms). Independent suspense
            so the header lights up even before featured entities resolve. */}
        <Suspense fallback={<StatsSkeleton />}>
          <StatsRow userId={userId} workspace={activeWorkspace} />
        </Suspense>

        {/* Featured entities: ~7-14 entities, ~150 facts. Cheap query +
            cheap render. The long tail comes through TailLoader on demand. */}
        <Suspense fallback={<FeaturedSkeleton />}>
          <FeaturedAndTail userId={userId} workspace={activeWorkspace} />
        </Suspense>
      </div>
    </main>
  );
}

async function ConnectedSourcesRow({
  userId,
  workspace,
}: {
  userId: string;
  workspace: string;
}) {
  const sources = await loadSourceStatuses(userId, workspace);
  return <ConnectedSources sources={sources} />;
}

async function StatsRow({
  userId,
  workspace,
}: {
  userId: string;
  workspace: string;
}) {
  const stats = await loadFactStats(userId, workspace);
  if (stats.totalActive === 0) return null;

  return (
    <div className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-500">
      <Stat label="active facts" value={stats.totalActive} />
      <span className="text-zinc-300 dark:text-zinc-700">·</span>
      <Stat label="entities" value={stats.totalEntities} />
      <span className="text-zinc-300 dark:text-zinc-700">·</span>
      <Stat label="sources" value={stats.distinctSources} />
      <span className="text-zinc-300 dark:text-zinc-700">·</span>
      <Stat
        label={`conflict${stats.unresolvedConflicts === 1 ? '' : 's'}`}
        value={stats.unresolvedConflicts}
        tone={stats.unresolvedConflicts > 0 ? 'amber' : 'default'}
      />
      {stats.totalSuperseded > 0 && (
        <>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <Stat label="superseded" value={stats.totalSuperseded} tone="muted" />
        </>
      )}
      {stats.totalRedacted > 0 && (
        <>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <Stat label="redacted" value={stats.totalRedacted} tone="muted" />
        </>
      )}
    </div>
  );
}

async function FeaturedAndTail({
  userId,
  workspace,
}: {
  userId: string;
  workspace: string;
}) {
  const [allSlugs, featured] = await Promise.all([
    loadEntitySlugsOrdered(userId, workspace),
    loadEntitiesBySlugs(userId, workspace, FEATURED_SLUGS),
  ]);

  if (allSlugs.length === 0) return <EmptyState />;

  // The tail = everything not in the featured set, in canonical order.
  const featuredSet = new Set(FEATURED_SLUGS);
  const tailSlugs = allSlugs.filter((s) => !featuredSet.has(s));

  return (
    <>
      <div className="mt-10 space-y-12">
        {featured.map((e, i) => (
          <EntitySection key={e.slug} entity={e} primary={i === 0} />
        ))}
      </div>
      <TailLoader workspace={workspace} tailSlugs={tailSlugs} />
    </>
  );
}

function StatsSkeleton() {
  return (
    <div className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-400">
      <span className="animate-pulse">loading stats…</span>
    </div>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="mt-10 animate-pulse space-y-12">
      {Array.from({ length: 5 }).map((_, i) => (
        <section key={i}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="h-4 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-12 rounded bg-zinc-100 dark:bg-zinc-900" />
          </div>
          <div className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="px-6 py-5">
                <div className="h-3 w-24 rounded bg-zinc-100 dark:bg-zinc-900" />
                <div className="mt-3 h-7 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="mt-3 h-3 w-48 rounded bg-zinc-100 dark:bg-zinc-900" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'amber' | 'muted';
}) {
  const valueColor =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-400'
      : tone === 'muted'
        ? 'text-zinc-400 dark:text-zinc-600'
        : 'text-zinc-900 dark:text-zinc-100';
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={`text-base tabular-nums tracking-normal ${valueColor}`}>
        {value}
      </span>
      <span>{label}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="mt-12 rounded-2xl border border-dashed border-zinc-300 bg-white p-14 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
        empty workspace
      </p>
      <p className="mt-3 text-base text-zinc-700 dark:text-zinc-300">
        No signed facts yet.
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        Drop a file above to ingest your own data, or click Sync to add the
        Slack / Gmail / PDF synthetic sources.
      </p>
    </div>
  );
}
