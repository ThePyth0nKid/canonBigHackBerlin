import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { loadDecisionInbox, loadOpenAuthorAsks } from '@/lib/canon/decide-view';
import { verifyMagicToken } from '@/lib/canon/decide-mail';
import { DecisionCard } from './_components/decision-card';
import { AuthorResponsePanel } from './_components/author-response-panel';
import { TopBar } from '../_components/top-bar';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    thread?: string;
    as?: string;
    exp?: string;
    sig?: string;
  }>;
}

/**
 * Customer / decision-maker view.
 *
 * Magic-link landing scopes the page to ONE card so the recipient can
 * only see the conflict they were asked about — not the full inbox.
 * (Real per-recipient session auth is V2; the demo's privacy guarantee
 * is HMAC token presence + thread-id filter.)
 */
export default async function DecidePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id?: string }).id;
  const email = (session.user as { email?: string | null }).email ?? null;
  if (!userId) redirect('/login');

  const params = await searchParams;
  const verifyResult =
    params.thread || params.as || params.sig || params.exp
      ? verifyMagicToken({
          thread: params.thread ?? null,
          as: params.as ?? null,
          exp: params.exp ?? null,
          sig: params.sig ?? null,
        })
      : null;
  const prefilledRespondingAs =
    verifyResult && verifyResult.ok ? verifyResult.as : null;
  const focusThreadId =
    verifyResult && verifyResult.ok ? verifyResult.threadId : null;
  const tokenError =
    verifyResult && !verifyResult.ok ? verifyResult.reason : null;

  const inbox = await loadDecisionInbox(userId, 'inazuma', email);
  const openAsks = await loadOpenAuthorAsks(userId, 'inazuma');

  // Magic-link arrival → scope cards to the focused thread only. Other
  // open conflicts in the workspace stay hidden so the email recipient
  // can't browse the full ledger from a shared link.
  const focusedCards = focusThreadId
    ? inbox.cards.filter((c) => c.thread?.threadId === focusThreadId)
    : null;
  const isMagicLinkScope = focusedCards !== null && focusedCards.length > 0;
  const visibleCards = focusedCards ?? inbox.cards;
  // When there's a verified token but no matching open card, the thread
  // was already settled by someone else (or the magic-link points at a
  // resolved thread). Show a clean "you're done" message rather than
  // dumping all 50 open decisions on the recipient.
  const focusedButSettled =
    focusThreadId !== null && focusedCards !== null && focusedCards.length === 0;

  return (
    <main className="flex flex-1 flex-col">
      <TopBar activeTab="decisions" openCount={inbox.count} userEmail={email} />
      <div className="mx-auto w-full max-w-3xl px-6 pb-10">
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
          </div>
          <p className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {isMagicLinkScope
              ? `You were asked about one specific conflict. ${inbox.count - 1} other open decision${inbox.count - 1 === 1 ? '' : 's'} in this workspace stay hidden — you only see what was routed to you.`
              : focusedButSettled
                ? 'The conflict you were asked about has already been settled by someone else.'
                : inbox.count === 0
                  ? 'No open decisions. Every conflicting claim has either auto-resolved by majority or been signed by a human.'
                  : `${inbox.count} open conflict${inbox.count === 1 ? '' : 's'} that auto-resolution couldn't settle. Each decision below becomes signed canon for every agent in the workspace.`}
          </p>
        </header>

        {prefilledRespondingAs && (
          <div className="mb-4 rounded-xl border-2 border-sky-400 bg-sky-50 p-4 dark:border-sky-700 dark:bg-sky-950/50">
            <p className="text-[10px] font-mono uppercase tracking-wide text-sky-600 dark:text-sky-400">
              Magic-link verified · scoped view
            </p>
            <p className="mt-1 text-sm font-semibold text-sky-900 dark:text-sky-100">
              Acting as <span className="font-mono">{prefilledRespondingAs}</span>
            </p>
            <p className="mt-1 text-[11px] text-sky-700 dark:text-sky-300">
              You arrived from an email about one specific conflict. Other open
              decisions in this workspace are hidden — you only see what was
              routed to you. Your response is signed and added to the
              hash-chained ledger.
            </p>
          </div>
        )}
        {tokenError && (
          <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-[12px] text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
            Magic-link {tokenError === 'expired' ? 'expired' : 'invalid'}. You can still respond manually below.
          </div>
        )}

        {openAsks.length > 0 && (
          <div className="mb-6">
            <AuthorResponsePanel
              asks={openAsks}
              viewerEmail={email ?? '(workspace owner)'}
              prefilledRespondingAs={prefilledRespondingAs}
              focusThreadId={focusThreadId}
            />
          </div>
        )}

        {visibleCards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            {focusedButSettled
              ? 'The conflict you were asked about has been settled. Nothing left to decide here.'
              : 'All clear · 0 open decisions'}
          </div>
        ) : (
          <div className="space-y-4">
            {visibleCards.map((card) => (
              <DecisionCard
                key={`${card.entity}::${card.metricKey}`}
                card={card}
                viewerEmail={email ?? ''}
                focusedFromMagicLink={isMagicLinkScope}
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
