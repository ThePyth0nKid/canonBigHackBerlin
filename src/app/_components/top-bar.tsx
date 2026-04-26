/**
 * Shared workspace top-bar — rendered on /app and /decide.
 *
 * Server component. Each page passes its own activeTab and a precomputed
 * count (via loadDecisionBadge for /app, via loadDecisionInbox.count for
 * /decide). Sign-out form lives here so individual pages don't redefine it.
 *
 * The bar replaces the per-page inline header sign-out form so the
 * persona-/view-switching motion in the demo is obvious: one click
 * between Ledger and Decisions, badge count visible the whole time.
 */

import Link from 'next/link';
import { signOut } from '@/auth';

export type TopBarTab = 'ledger' | 'decisions';

interface TopBarProps {
  activeTab: TopBarTab;
  /** Open decisions count. Hidden when zero. */
  openCount: number;
  /** Email of the signed-in user, shown next to sign-out for context. */
  userEmail?: string | null;
}

export function TopBar({ activeTab, openCount, userEmail }: TopBarProps) {
  return (
    <nav className="sticky top-0 z-30 mb-6 flex items-center justify-between border-b border-zinc-200 bg-white/85 px-6 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
      <div className="flex items-center gap-1">
        <Tab href="/app" label="Ledger" active={activeTab === 'ledger'} />
        <Tab
          href="/decide"
          label="Decisions"
          active={activeTab === 'decisions'}
          badge={openCount}
        />
      </div>
      <div className="flex items-center gap-3">
        {userEmail && (
          <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline">
            {userEmail}
          </span>
        )}
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            className="text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}

function Tab({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const baseClass =
    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors';
  const activeClass =
    'bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900';
  const inactiveClass =
    'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800';
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`${baseClass} ${active ? activeClass : inactiveClass}`}
    >
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
            active
              ? 'bg-white/20 text-white dark:bg-zinc-900/20 dark:text-zinc-900'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
          }`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
