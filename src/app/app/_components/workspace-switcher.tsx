'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

interface WorkspaceOption {
  slug: string;
  label: string;
  description: string;
}

interface Props {
  active: string;
  workspaces: readonly WorkspaceOption[];
  /** Per-workspace badge — usually `${factCount} facts`. */
  badges?: Record<string, string>;
}

/**
 * URL-driven workspace toggle. Reads the current pathname so it can
 * preserve the path while flipping the `?ws=` query param. Server-rendered
 * /app reads the same param for its data fetch.
 */
export function WorkspaceSwitcher({ active, workspaces, badges }: Props) {
  const pathname = usePathname();
  const sp = useSearchParams();

  return (
    <nav
      aria-label="Workspace"
      className="inline-flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950"
    >
      {workspaces.map((ws) => {
        const isActive = ws.slug === active;
        const params = new URLSearchParams(sp?.toString() ?? '');
        if (ws.slug === 'northwind') params.delete('ws');
        else params.set('ws', ws.slug);
        const qs = params.toString();
        const href = qs ? `${pathname}?${qs}` : pathname;
        return (
          <Link
            key={ws.slug}
            href={href}
            title={ws.description}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <span>{ws.label}</span>
            {badges?.[ws.slug] && (
              <span
                className={`font-mono text-[10px] tracking-wide ${
                  isActive
                    ? 'text-zinc-300 dark:text-zinc-600'
                    : 'text-zinc-400 dark:text-zinc-600'
                }`}
              >
                {badges[ws.slug]}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
