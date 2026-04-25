import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { loadDecisionInbox, loadOpenAuthorAsks } from '@/lib/canon/decide-view';
import { DecisionCard } from './_components/decision-card';
import { AuthorResponsePanel } from './_components/author-response-panel';

export const dynamic = 'force-dynamic';

/**
 * Customer / decision-maker view.
 *
 * Same auth, same workspace, same ledger as /app — but a *role-shaped*
 * surface: only the conflicts that need a human, plus the "asked of you"
 * inbox if the signed-in user is an addressee. No ingest controls, no
 * full ledger, no proof modal — those live in /app.
 */
export default async function DecidePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id?: string }).id;
  const email = (session.user as { email?: string | null }).email ?? null;
  if (!userId) redirect('/login');

  const inbox = await loadDecisionInbox(userId, 'inazuma', email);
  const openAsks = await loadOpenAuthorAsks(userId, 'inazuma');

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">
                Decisions
              </h1>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">
                truth · pending
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
          <p className="text-[13px] text-zinc-600 dark:text-zinc-400">
            {email ? <span className="font-mono text-[11px]">{email}</span> : null}
            {' · '}
            <span className="font-mono text-[11px]">inazuma</span>
            {' · '}
            <Link
              href="/app"
              className="text-sky-600 hover:underline dark:text-sky-400"
            >
              ledger view →
            </Link>
          </p>
          <p className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {inbox.count === 0
              ? 'No open decisions. Every conflicting claim has either auto-resolved by majority or been signed by a human.'
              : `${inbox.count} open conflict${inbox.count === 1 ? '' : 's'} that auto-resolution couldn't settle. Each decision below becomes signed canon for every agent in the workspace.`}
          </p>
        </header>

        {openAsks.length > 0 && (
          <div className="mb-6">
            <AuthorResponsePanel asks={openAsks} viewerEmail={email ?? '(workspace owner)'} />
          </div>
        )}

        {inbox.cards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            All clear · 0 open decisions
          </div>
        ) : (
          <div className="space-y-4">
            {inbox.cards.map((card) => (
              <DecisionCard
                key={`${card.entity}::${card.metricKey}`}
                card={card}
                viewerEmail={email ?? ''}
              />
            ))}
          </div>
        )}

        <footer className="mt-10 border-t border-zinc-200 pt-4 text-[11px] text-zinc-500 dark:border-zinc-800">
          Every action on this page emits a signed FactEvent into the same
          hash-chained ledger. <Link href="/app" className="underline">/app</Link> shows
          the audit trail.
        </footer>
      </div>
    </main>
  );
}
