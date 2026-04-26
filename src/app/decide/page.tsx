import { auth, signOut } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { loadDecisionInbox, loadOpenAuthorAsks } from '@/lib/canon/decide-view';
import { verifyMagicToken } from '@/lib/canon/decide-mail';
import { DecisionCard } from './_components/decision-card';
import { AuthorResponsePanel } from './_components/author-response-panel';

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
 * Same auth, same workspace, same ledger as /app — but a *role-shaped*
 * surface: only the conflicts that need a human, plus the "asked of you"
 * inbox if the signed-in user is an addressee. No ingest controls, no
 * full ledger, no proof modal — those live in /app.
 *
 * Magic-link landing: when ?thread=&as=&exp=&sig= is present, the HMAC
 * is verified against MAGIC_LINK_SECRET. On valid tokens, the
 * AuthorResponsePanel locks to the persona and surfaces the matching
 * thread up top — one-click respond. On invalid/expired tokens, the
 * page renders normally (no error, no auth side-effect).
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

        {prefilledRespondingAs && (
          <div className="mb-4 rounded-xl border-2 border-sky-400 bg-sky-50 p-4 dark:border-sky-700 dark:bg-sky-950/50">
            <p className="text-[10px] font-mono uppercase tracking-wide text-sky-600 dark:text-sky-400">
              Magic-link verified
            </p>
            <p className="mt-1 text-sm font-semibold text-sky-900 dark:text-sky-100">
              Acting as <span className="font-mono">{prefilledRespondingAs}</span>
            </p>
            <p className="mt-1 text-[11px] text-sky-700 dark:text-sky-300">
              You arrived from an email asking your input on a Canon conflict.
              Your response will be signed and added to the hash-chained ledger.
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
