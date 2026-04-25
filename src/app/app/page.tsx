import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import { loadFactLandscape, type EntityGroup, type MetricGroup } from '@/lib/canon/view';
import { ProofButton } from './_components/proof-modal';
import { ConflictResolve } from './_components/conflict-resolve';
import { SourcePill } from './_components/source-pill';
import { AikidoRepoBanner } from './_components/aikido-banner';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id?: string }).id;
  if (!userId) redirect('/login');

  const land = await loadFactLandscape(userId);
  const empty = land.entities.length === 0;

  return (
    <main className="flex flex-1 flex-col px-6 py-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Northwind Software</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {empty ? (
                <>No facts yet — sync to populate.</>
              ) : (
                <>
                  {land.totalActive} facts · {land.distinctSources} sources ·{' '}
                  {land.unresolvedConflicts} conflict{land.unresolvedConflicts === 1 ? '' : 's'} need{land.unresolvedConflicts === 1 ? 's' : ''} resolution
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AikidoRepoBanner />
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/' });
              }}
            >
              <button
                type="submit"
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        {empty ? <EmptyState /> : <Landscape entities={land.entities} />}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
      <p className="text-sm text-zinc-500">No facts in this workspace yet.</p>
      <p className="mt-2 text-sm text-zinc-500">
        Run <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-900">npx tsx scripts/sync-smoke.ts</code> or
        click <span className="font-medium">Sync now</span> once it ships.
      </p>
    </div>
  );
}

function Landscape({ entities }: { entities: EntityGroup[] }) {
  return (
    <div className="mt-10 space-y-10">
      {entities.map((e) => (
        <EntitySection key={e.slug} entity={e} />
      ))}
    </div>
  );
}

function EntitySection({ entity }: { entity: EntityGroup }) {
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight">{entity.displayName}</h2>
        <span className="font-mono text-xs text-zinc-500">
          {entity.totalFacts} fact{entity.totalFacts === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-4 divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {entity.metrics.map((m) => (
          <MetricRow
            key={m.key}
            entity={entity.slug}
            metric={m}
          />
        ))}
        {entity.metrics.length === 0 && entity.loose.length === 0 && (
          <div className="p-6 text-sm text-zinc-500">No active facts.</div>
        )}
      </div>
    </section>
  );
}

function MetricRow({ entity, metric }: { entity: string; metric: MetricGroup }) {
  const winnerFact = metric.active.find(
    (f) => f.metricValue === metric.winnerValue,
  ) ?? metric.active[0];
  const competing = metric.active;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 p-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">{metric.label}</span>
          {metric.corroborated && (
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">
              ✓ {metric.confirmingSources.length} sources
            </span>
          )}
          {metric.needsHumanResolve && (
            <ConflictResolve
              entity={entity}
              metricKey={metric.key}
              competing={competing}
            />
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-semibold tabular-nums">
            {metric.winnerValue ?? '—'}
          </span>
          {metric.winnerUnit && (
            <span className="text-sm text-zinc-500">{metric.winnerUnit}</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {metric.confirmingSources.map((s) => (
            <SourcePill key={s} kind={s} />
          ))}
          {metric.superseded.length > 0 && (
            <span className="font-mono text-[10px] text-zinc-400">
              · {metric.superseded.length} superseded
            </span>
          )}
        </div>
      </div>
      {winnerFact && (
        <div className="flex flex-col items-end gap-1">
          <ProofButton fact={winnerFact} />
          <span className="font-mono text-[10px] text-zinc-400">
            {winnerFact.eventHash.slice(0, 12)}…
          </span>
        </div>
      )}
    </div>
  );
}
