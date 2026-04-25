import { getRepoBanner, type AikidoBanner } from '@/lib/canon/aikido';

/**
 * Live repo-health banner — Layer 3's recursive trust beat:
 * "Canon's own source code is Aikido-monitored, 0 issues."
 * Read-only; refreshes on page reload (revalidatePath after sync).
 */
export async function AikidoRepoBanner() {
  let banner: AikidoBanner | null = null;
  try {
    banner = await getRepoBanner();
  } catch {
    // Network blip → render a muted offline pill rather than vanishing.
    return (
      <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
        <span
          className="inline-block h-2 w-2 rounded-full bg-zinc-400"
          aria-hidden
        />
        <span className="font-mono text-zinc-500">aikido</span>
        <span className="text-zinc-400">offline</span>
      </div>
    );
  }

  const ok = banner.totalIssues === 0;

  return (
    <div className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
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
        {banner.workspaceName} / <span className="font-medium">{banner.repoName}</span>
      </span>
      <span className="text-zinc-400">·</span>
      <span
        className={
          ok
            ? 'font-medium text-emerald-700 dark:text-emerald-400'
            : 'font-medium text-amber-700 dark:text-amber-400'
        }
      >
        {banner.totalIssues === 0
          ? '0 issues'
          : `${banner.totalIssues} issues (${banner.criticalIssues} critical)`}
      </span>
      <span className="text-zinc-400">·</span>
      <span className="font-mono text-[10px] text-zinc-500">
        {new Date(banner.fetchedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  );
}
