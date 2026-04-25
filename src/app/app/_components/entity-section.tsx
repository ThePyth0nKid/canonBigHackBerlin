'use client';

/**
 * Renders one entity's metric grid. Lifted out of page.tsx so the same
 * markup can be used by the server-rendered featured section AND by the
 * client-side TailLoader (which receives EntityGroup[] from a Server
 * Action). 'use client' is the load-bearing bit: TailLoader can't
 * mount a Server Component dynamically.
 */

import type { EntityGroup, FactRow, MetricGroup } from '@/lib/canon/view';
import { ProofButton } from './proof-modal';
import { ConflictResolve } from './conflict-resolve';
import { SourcePill } from './source-pill';

export function EntitySection({
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
  const winnerFact: FactRow | undefined =
    metric.active.find((f) => f.metricValue === metric.winnerValue) ??
    metric.active[0];
  const competing = metric.active;
  const auditFlagged = [...metric.active, ...metric.superseded].some((f) =>
    (f.notes ?? '').startsWith('audit:'),
  );

  return (
    <div
      data-conflict-anchor={metric.needsHumanResolve ? '' : undefined}
      className="group flex flex-wrap items-start justify-between gap-6 px-6 py-5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40"
    >
      <div className="min-w-0 flex-1">
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
