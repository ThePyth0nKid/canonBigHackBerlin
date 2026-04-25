import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import {
  loadFactLandscape,
  WORKSPACES,
  type EntityGroup,
  type MetricGroup,
} from '@/lib/canon/view';
import { ProofButton } from './_components/proof-modal';
import { ConflictResolve } from './_components/conflict-resolve';
import { SourcePill } from './_components/source-pill';
import { AikidoRepoBanner } from './_components/aikido-banner';
import { SyncButton } from './_components/sync-button';
import { WorkspaceSwitcher } from './_components/workspace-switcher';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id?: string }).id;
  if (!userId) redirect('/login');

  const sp = await searchParams;
  const wsParam = sp?.ws ?? 'northwind';
  const activeWorkspace =
    WORKSPACES.find((w) => w.slug === wsParam)?.slug ?? 'northwind';

  // Per-workspace fact counts for the switcher badges (one extra cheap query
  // — gives jurors the "two workspaces, one ledger" beat at a glance).
  const counts = await prisma.factEvent.groupBy({
    by: ['workspace'],
    where: { userId, status: 'active' },
    _count: { _all: true },
  });
  const badges: Record<string, string> = {};
  for (const w of WORKSPACES) {
    const c = counts.find((x) => x.workspace === w.slug);
    badges[w.slug] = c ? `${c._count._all}` : '0';
  }

  const land = await loadFactLandscape(userId, activeWorkspace);
  const empty = land.entities.length === 0;
  const wsMeta =
    WORKSPACES.find((w) => w.slug === activeWorkspace) ?? WORKSPACES[0];

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">
                {workspaceTitle(activeWorkspace)}
              </h1>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] ${
                  activeWorkspace === 'northwind'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                }`}
              >
                {activeWorkspace === 'northwind' ? 'demo workspace' : 'qontext dataset'}
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

          <div className="flex flex-wrap items-center justify-between gap-3">
            <WorkspaceSwitcher
              active={activeWorkspace}
              workspaces={WORKSPACES}
              badges={badges}
            />
            {wsMeta && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                {wsMeta.description}
              </span>
            )}
          </div>

          {!empty && (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-500">
              <Stat label="active facts" value={land.totalActive} />
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Stat label="sources" value={land.distinctSources} />
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <Stat
                label={`conflict${land.unresolvedConflicts === 1 ? '' : 's'}`}
                value={land.unresolvedConflicts}
                tone={land.unresolvedConflicts > 0 ? 'amber' : 'default'}
              />
              {land.totalSuperseded > 0 && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <Stat
                    label="superseded"
                    value={land.totalSuperseded}
                    tone="muted"
                  />
                </>
              )}
              {land.totalRedacted > 0 && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <Stat
                    label="redacted"
                    value={land.totalRedacted}
                    tone="muted"
                  />
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-900">
            <AikidoRepoBanner />
            <SyncButton />
          </div>
        </header>

        {empty ? (
          <EmptyState workspace={activeWorkspace} />
        ) : (
          <Landscape entities={land.entities} workspace={activeWorkspace} />
        )}
      </div>
    </main>
  );
}

function workspaceTitle(slug: string): string {
  if (slug === 'inazuma') return 'Inazuma.co';
  return 'Northwind Software';
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

function EmptyState({ workspace }: { workspace: string }) {
  return (
    <div className="mt-12 rounded-2xl border border-dashed border-zinc-300 bg-white p-14 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
        empty workspace
      </p>
      <p className="mt-3 text-base text-zinc-700 dark:text-zinc-300">
        No signed facts yet in {workspace === 'inazuma' ? 'Inazuma' : 'Northwind'}.
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        {workspace === 'inazuma' ? (
          <>
            Run <code className="rounded bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-900">npx tsx scripts/ingest-qontext.ts --reset --no-audit</code>{' '}
            to ingest the Qontext-supplied dataset.
          </>
        ) : (
          <>
            Click <span className="font-medium">Sync now</span> to ingest from
            Slack, Gmail, and the Q1 board deck.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The workspace landscape. Northwind has ~5 entities — render straight.
 * Inazuma has 100+ entities — group "demo gold" entities (the planted
 * conflict-rich set) on top, then collapse the long tail behind a
 * <details> so the page stays readable from row 5 of the audience.
 */
const INAZUMA_DEMO_GOLD = new Set([
  'inazuma',
  'miller_group', 'gonzalez_inc', 'johnson_group',
  'huang_llc', 'williams_group', 'martin_ltd',
]);

function Landscape({
  entities,
  workspace,
}: {
  entities: EntityGroup[];
  workspace: string;
}) {
  if (workspace !== 'inazuma' || entities.length <= 12) {
    return (
      <div className="mt-10 space-y-12">
        {entities.map((e, i) => (
          <EntitySection key={e.slug} entity={e} primary={i === 0} />
        ))}
      </div>
    );
  }

  const featured = entities.filter((e) => INAZUMA_DEMO_GOLD.has(e.slug));
  const tail = entities.filter((e) => !INAZUMA_DEMO_GOLD.has(e.slug));

  return (
    <div className="mt-10 space-y-12">
      {featured.map((e, i) => (
        <EntitySection key={e.slug} entity={e} primary={i === 0} />
      ))}
      <details className="group border-t border-zinc-200 pt-6 dark:border-zinc-900">
        <summary className="flex cursor-pointer items-center gap-2 list-none font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200">
          <span aria-hidden className="select-none transition-transform group-open:rotate-90">
            ›
          </span>
          {tail.length} more entities · audit-history accessible
        </summary>
        <div className="mt-6 space-y-12">
          {tail.map((e) => (
            <EntitySection key={e.slug} entity={e} />
          ))}
        </div>
      </details>
    </div>
  );
}

function EntitySection({
  entity,
  primary,
}: {
  entity: EntityGroup;
  primary?: boolean;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        {primary ? (
          <h2 className="text-xl font-semibold tracking-tight">
            {entity.displayName}
          </h2>
        ) : (
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            {entity.displayName}
          </h2>
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
          {entity.totalFacts} fact{entity.totalFacts === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-3 divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {entity.metrics.map((m) => (
          <MetricRow key={m.key} entity={entity.slug} metric={m} />
        ))}
        {entity.metrics.length === 0 && entity.loose.length === 0 && (
          <div className="p-6 text-sm text-zinc-500">No active facts.</div>
        )}
      </div>
    </section>
  );
}

function MetricRow({ entity, metric }: { entity: string; metric: MetricGroup }) {
  const winnerFact =
    metric.active.find((f) => f.metricValue === metric.winnerValue) ??
    metric.active[0];
  const competing = metric.active;
  const auditFlagged = [...metric.active, ...metric.superseded].some((f) =>
    (f.notes ?? '').startsWith('audit:'),
  );

  return (
    <div className="group flex flex-wrap items-start justify-between gap-6 px-6 py-5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40">
      <div className="min-w-0 flex-1">
        {/* eyebrow row */}
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            {metric.label}
          </span>
          {metric.corroborated && (
            <span
              title={`Confirmed by ${metric.confirmingSources.length} independent sources`}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
            >
              <span aria-hidden>✓</span>
              {metric.confirmingSources.length}
            </span>
          )}
          {auditFlagged && (
            <span
              title="Gemini audit flagged this fact's source context"
              className="text-[11px] font-medium text-sky-600 dark:text-sky-400"
            >
              audit·flag
            </span>
          )}
        </div>

        {/* hero value */}
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50">
            {metric.winnerValue ?? '—'}
          </span>
          {metric.winnerUnit && (
            <span className="text-base font-medium text-zinc-400">
              {metric.winnerUnit}
            </span>
          )}
        </div>

        {/* sources strip */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {metric.confirmingSources.map((s) => (
            <SourcePill key={s} kind={s} />
          ))}
          {metric.superseded.length > 0 && (
            <span className="font-mono text-[10px] tracking-wider text-zinc-400">
              · {metric.superseded.length} superseded
            </span>
          )}
        </div>
      </div>

      {/* RIGHT actions stack */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {metric.needsHumanResolve ? (
          <ConflictResolve
            entity={entity}
            metricKey={metric.key}
            competing={competing}
          />
        ) : (
          winnerFact && <ProofButton fact={winnerFact} />
        )}
        {winnerFact && (
          <span className="font-mono text-[10px] tracking-wider text-zinc-400">
            {winnerFact.eventHash.slice(0, 12)}…
          </span>
        )}
      </div>
    </div>
  );
}
