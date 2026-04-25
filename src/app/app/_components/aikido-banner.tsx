import { getRepoBanner, type AikidoBanner } from '@/lib/canon/aikido';

/**
 * Live repo-health banner — Layer 3's recursive trust beat:
 * Canon's own source code is Aikido-monitored, with a transparent
 * triage breakdown (open critical / high / ignored). Pitch story:
 * "we don't claim 0 issues, we claim transparent triage."
 *
 * Read-only; refreshes on /app reload (revalidatePath after sync).
 */
export async function AikidoRepoBanner() {
  let banner: AikidoBanner | null = null;
  try {
    banner = await getRepoBanner();
  } catch {
    return (
      <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
        <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-500">
          aikido
        </span>
        <span className="text-zinc-400">offline</span>
      </div>
    );
  }

  const openTotal =
    banner.openCritical + banner.openHigh + banner.openMedium + banner.openLow;
  const ok = banner.openCritical === 0 && banner.openHigh === 0;
  const fetchedTime = new Date(banner.fetchedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <details className="group rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span className="relative inline-flex h-2 w-2" aria-hidden>
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
              ok ? 'animate-ping bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              ok ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-500">
          aikido
        </span>
        <span className="text-zinc-700 dark:text-zinc-300">
          {banner.workspaceName} /{' '}
          <span className="font-medium">{banner.repoName}</span>
        </span>
        <span className="text-zinc-400">·</span>
        <TriageStrip
          openCritical={banner.openCritical}
          openHigh={banner.openHigh}
          openMedium={banner.openMedium}
          openLow={banner.openLow}
          ignored={banner.ignored}
        />
        <span className="text-zinc-400">·</span>
        <span className="font-mono text-[10px] text-zinc-500">{fetchedTime}</span>
        <span
          aria-hidden
          className="ml-1 select-none text-zinc-400 transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      {(openTotal > 0 || banner.ignored > 0 || banner.topOpen.length > 0) && (
        <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {Object.keys(banner.byType).length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
              {Object.entries(banner.byType).map(([t, n]) => (
                <span key={t}>
                  <span className="text-zinc-700 dark:text-zinc-300">{n}</span> {t}
                </span>
              ))}
            </div>
          )}
          {banner.topOpen.length > 0 ? (
            <ul className="space-y-1.5">
              {banner.topOpen.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-baseline gap-2 text-[11px]"
                >
                  <SeverityBadge sev={i.severity} />
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">
                    {i.rule ?? i.type}
                  </span>
                  {i.affectedFile && (
                    <span className="font-mono text-[10px] text-zinc-500">
                      {i.affectedFile}
                    </span>
                  )}
                  {i.cveId && (
                    <span className="font-mono text-[10px] text-zinc-500">
                      {i.cveId}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-zinc-500">
              No open findings. {banner.ignored} ignored, {banner.closed} closed
              after triage.
            </p>
          )}
        </div>
      )}
    </details>
  );
}

function TriageStrip({
  openCritical,
  openHigh,
  openMedium,
  openLow,
  ignored,
}: {
  openCritical: number;
  openHigh: number;
  openMedium: number;
  openLow: number;
  ignored: number;
}) {
  const segments: Array<{ count: number; label: string; color: string }> = [
    { count: openCritical, label: 'crit', color: 'text-rose-700 dark:text-rose-400' },
    { count: openHigh, label: 'high', color: 'text-amber-700 dark:text-amber-400' },
    { count: openMedium, label: 'med', color: 'text-yellow-700 dark:text-yellow-400' },
    { count: openLow, label: 'low', color: 'text-zinc-700 dark:text-zinc-300' },
    { count: ignored, label: 'ign', color: 'text-zinc-400 dark:text-zinc-500' },
  ];
  const visible = segments.filter((s) => s.count > 0);
  if (visible.length === 0) {
    return (
      <span className="font-medium text-emerald-700 dark:text-emerald-400">
        0 issues
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 font-mono text-[11px]">
      {visible.map((s) => (
        <span key={s.label} className={s.color}>
          <span className="font-semibold">{s.count}</span> {s.label}
        </span>
      ))}
    </span>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  const cls =
    sev === 'critical'
      ? 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
      : sev === 'high'
        ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : sev === 'medium'
          ? 'border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300'
          : 'border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400';
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${cls}`}
    >
      {sev}
    </span>
  );
}
