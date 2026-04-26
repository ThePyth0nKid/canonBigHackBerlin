'use client';

/**
 * "Ask Canon" — top-of-page free-form Q&A box backed by Gemini 2.5-flash
 * over the signed ledger. Demo beat: a non-developer asks a business
 * question in natural language; Canon answers using ONLY the signed
 * facts and surfaces the cited factIds so the auditor can verify each
 * claim against the COSE_Sign1 envelope.
 *
 * Hallucination defence happens server-side (askCanon strips citations
 * the model invented from the response). The UI just renders.
 *
 * UI layout follows a strict three-zone hierarchy so the answer can be
 * scanned at a glance:
 *
 *   1. Meta strip   — Gemini latency + scanned-N + confidence chip.
 *   2. Action zone  — for conflict intent: large "Resolve N" header +
 *                     fight cards (top 3 expanded, rest collapsed).
 *                     For other intents: nothing here.
 *   3. Reading zone — the Gemini prose. Demoted when conflicts exist
 *                     (it's just an explanation of the cards above).
 *   4. Provenance   — citation cards. Suppressed entirely when conflicts
 *                     are present (the fight cards already carry the
 *                     same factIds — rendering them again doubles
 *                     the page length without adding info).
 */

import { useState, useTransition } from 'react';
import { askCanonAction } from '../_actions/ask-canon';
import { searchWebContextAction, type WebContextResult } from '../_actions/web-context';
import type { CanonAnswer, CanonCitation } from '@/lib/canon/ask';
import { AskFightCard } from './ask-fight-card';
import { BrandChip, brandFor } from './ask-source-brand';

const SUGGESTIONS = [
  'What\'s the conflict on Miller Group?',
  'Which products have a corroborated price?',
  'Who is the primary contact at Gonzalez Inc?',
  'What\'s Bright Plc\'s relationship type?',
] as const;

const CONFLICTS_VISIBLE = 3;

export function AskCanon() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<CanonAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setError(null);
    setAnswer(null);
    start(async () => {
      try {
        const res = await askCanonAction({ question: trimmed });
        if ('error' in res) {
          setError(res.error);
          setAnswer(null);
        } else {
          setAnswer(res);
          setError(null);
        }
      } catch (e) {
        // Server actions reject when the runtime throws past the action
        // body. Without this catch the spinner stayed armed forever.
        setError((e as Error)?.message ?? 'Ask Canon failed unexpectedly');
        setAnswer(null);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-violet-300 bg-gradient-to-br from-violet-50 to-white p-4 dark:border-violet-700/50 dark:from-violet-950/30 dark:to-zinc-950">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <div className="min-w-0 flex-1">
          <label className="block font-mono text-[10px] uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
            Ask Canon · Gemini answers from your signed ledger
          </label>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What's Miller Group's industry?  ·  Why is the Gonzalez Inc tier conflicted?"
            disabled={pending}
            className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/40 disabled:opacity-60 dark:border-violet-700/40 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <button
          type="submit"
          disabled={pending || !question.trim()}
          className="inline-flex h-9 shrink-0 items-center justify-center self-end rounded-full bg-violet-600 px-5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
        >
          {pending ? 'Thinking…' : 'Ask →'}
        </button>
      </form>

      {!answer && !pending && !error && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuestion(s);
                submit(s);
              }}
              className="rounded-full border border-violet-200 bg-white/60 px-3 py-1 font-mono text-[10px] tracking-wide text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-100 dark:border-violet-700/40 dark:bg-zinc-900/60 dark:text-violet-200 dark:hover:border-violet-500 dark:hover:bg-violet-950/60"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 dark:border-rose-700/50 dark:bg-rose-950/40">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-wider text-rose-600 dark:text-rose-400">
                ask canon failed
              </p>
              <p className="mt-1 text-sm text-rose-900 dark:text-rose-100">{error}</p>
              {question && (
                <p className="mt-1 truncate font-mono text-[10px] text-rose-700/80 dark:text-rose-300/70">
                  question: “{question}”
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => submit(question)}
              disabled={pending || !question.trim()}
              className="inline-flex h-7 shrink-0 items-center justify-center rounded-full border border-rose-400 bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-rose-800 transition-colors hover:bg-rose-100 disabled:opacity-60 dark:border-rose-600 dark:bg-rose-900/30 dark:text-rose-200 dark:hover:bg-rose-900/60"
            >
              retry
            </button>
          </div>
        </div>
      )}

      {answer && !pending && <AnswerBlock answer={answer} question={question} />}
    </div>
  );
}

function AnswerBlock({ answer, question }: { answer: CanonAnswer; question: string }) {
  const tone =
    answer.confidence === 'high'
      ? {
          label: 'high confidence',
          chip: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200',
        }
      : answer.confidence === 'medium'
        ? {
            label: 'medium confidence',
            chip: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200',
          }
        : {
            label: 'low confidence',
            chip: 'border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300',
          };

  // Build a citation lookup keyed by factId so we can render inline
  // [N] tokens as anchored links to the right surface — fight card when
  // available, citation card otherwise.
  const citationById = new Map(answer.citations.map((c) => [c.factId, c]));
  const factIdToFightAnchor = new Map<string, string>();
  for (const c of answer.conflicts) {
    const anchor = `fight-${c.entity}-${c.metricKey}`;
    for (const cand of c.candidates) {
      factIdToFightAnchor.set(cand.factId, anchor);
    }
  }

  const hasConflicts = answer.conflicts.length > 0;
  // When the question is conflict-intent the fight cards already enumerate
  // every relevant factId. Rendering the CitationCard list a second time
  // doubles page length without adding info — so suppress it.
  const showCitationList = !hasConflicts && answer.citations.length > 0;

  return (
    <div className="mt-4 space-y-4">
      {/* ZONE 1 — meta strip. Always present, always small. */}
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="text-violet-700 dark:text-violet-300">
          Gemini · 2.5-flash · {answer.latencyMs}ms · scanned {answer.retrievedCount} facts
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold tracking-wider ${tone.chip}`}
        >
          {tone.label}
        </span>
      </div>

      {/* ZONE 2 — action surface. Dominant when conflicts are present. */}
      {hasConflicts && (
        <ConflictAction
          answer={answer}
          prose={answer.answer}
          citationById={citationById}
          factIdToFightAnchor={factIdToFightAnchor}
        />
      )}

      {/* ZONE 3 — Gemini prose. Promoted when no conflicts; demoted to
          a small "why" panel inside ConflictAction otherwise. */}
      {!hasConflicts && (
        <p className="text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100">
          {renderAnswerWithCitations(
            answer.answer,
            citationById,
            factIdToFightAnchor,
          )}
        </p>
      )}

      {/* ZONE 4 — UNSIGNED public-web context. Sits right after the
          answer/conflict content so the user always reaches it even when
          fight cards push the rest of the page far down. Trust gradient
          made explicit; every Tavily item carries an unsigned badge. */}
      <ExternalContextSection question={question} />

      {/* ZONE 5 — provenance. Only when not double-covered by fight cards. */}
      {showCitationList && (
        <section>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            {answer.citations.length} signed source{answer.citations.length === 1 ? '' : 's'}
          </p>
          <div className="grid gap-2">
            {answer.citations.map((c, i) => (
              <CitationCard key={c.factId} index={i + 1} cite={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * ConflictAction — the decision-first surface used when intent=conflict.
 * Hero header tells the user what they're being asked to do; below it,
 * top-N fight cards expanded + the rest summarised in one-line rows.
 * The Gemini prose lives in a small expandable "why this is conflicted"
 * panel underneath so it's available without dominating the screen.
 * -------------------------------------------------------------------------- */

function ConflictAction({
  answer,
  prose,
  citationById,
  factIdToFightAnchor,
}: {
  answer: CanonAnswer;
  prose: string;
  citationById: Map<string, CanonCitation>;
  factIdToFightAnchor: Map<string, string>;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const total = answer.conflicts.length;
  const visibleCount = showAll ? total : Math.min(CONFLICTS_VISIBLE, total);
  const visible = answer.conflicts.slice(0, visibleCount);
  const collapsed = answer.conflicts.slice(visibleCount);

  return (
    <section className="space-y-3">
      {/* Hero header — frames the screen as a decision interface, not a
          search result. */}
      <header className="rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-4 dark:border-amber-700/60 dark:from-amber-950/40 dark:to-zinc-950">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
              Decision required
            </p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {total} conflict{total === 1 ? '' : 's'} in your ledger
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Pick the canonical value or mark the candidates as distinct
              records. Each click signs a ResolutionEvent on the chain.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            className="inline-flex h-7 items-center justify-center rounded-full border border-violet-300 bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-700 transition-colors hover:bg-violet-50 dark:border-violet-700/60 dark:bg-zinc-950 dark:text-violet-200 dark:hover:bg-violet-950/40"
            aria-expanded={showWhy}
          >
            {showWhy ? "hide gemini's note −" : "gemini's note +"}
          </button>
        </div>

        {showWhy && (
          <p className="mt-3 border-t border-amber-200/60 pt-3 text-sm leading-relaxed text-zinc-800 dark:border-amber-800/40 dark:text-zinc-200">
            {renderAnswerWithCitations(prose, citationById, factIdToFightAnchor)}
          </p>
        )}
      </header>

      {/* Cards — top N expanded. */}
      <div className="space-y-3">
        {visible.map((c, i) => (
          <AskFightCard
            key={`${c.entity}::${c.metricKey}`}
            conflict={c}
            index={i + 1}
            total={total}
          />
        ))}
      </div>

      {/* Collapsed tail — one-line rows, click to expand them all. */}
      {collapsed.length > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="block w-full rounded-xl border border-dashed border-zinc-300 bg-white/60 p-3 text-left transition-colors hover:border-zinc-400 hover:bg-white dark:border-zinc-700/60 dark:bg-zinc-950/60 dark:hover:border-zinc-600 dark:hover:bg-zinc-950"
        >
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
            + {collapsed.length} more conflict{collapsed.length === 1 ? '' : 's'} · expand
          </p>
          <ul className="mt-2 grid gap-1">
            {collapsed.map((c) => (
              <li
                key={`${c.entity}::${c.metricKey}`}
                className="flex items-baseline justify-between gap-3 font-mono text-[11px] text-zinc-500"
              >
                <span className="truncate">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {c.entityDisplay}
                  </span>
                  <span className="ml-1.5 text-zinc-400">· {c.metricKey}</span>
                </span>
                <span className="shrink-0 text-zinc-400">
                  {c.candidates.length} values
                </span>
              </li>
            ))}
          </ul>
        </button>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- *
 * Inline citation rendering. Walks the Gemini prose, replaces [f_XXX]
 * tokens with little pills coloured by source-kind. Clicking a pill
 * scrolls to either:
 *   - the matching fight card (if the factId is part of a conflict), OR
 *   - the citation card (#cite-N) otherwise.
 * Unknown ids render as muted "[?]" — defence-in-depth; askCanon strips
 * hallucinated ids server-side.
 * -------------------------------------------------------------------------- */

const CITATION_RE = /\[(f_[A-Za-z0-9]+)\]/g;

function renderAnswerWithCitations(
  text: string,
  byId: Map<string, CanonCitation>,
  fightAnchorByFactId: Map<string, string>,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let citationIdx = 0;
  const indexOfId = new Map<string, number>();
  for (const id of byId.keys()) {
    indexOfId.set(id, ++citationIdx);
  }
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    const id = match[1];
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const idx = indexOfId.get(id);
    const cite = byId.get(id);
    if (idx && cite) {
      const fightAnchor = fightAnchorByFactId.get(id);
      const href = fightAnchor ? `#${fightAnchor}` : `#cite-${idx}`;
      const b = brandFor(cite.sourceRef);
      const tooltip = `${cite.entity}${cite.metricKey ? ` · ${cite.metricKey}` : ''} — ${cite.claim}`;
      parts.push(
        <a
          key={`${id}-${match.index}`}
          href={href}
          title={tooltip}
          className={`mx-0.5 inline-flex items-center gap-1 rounded border px-1 py-px font-mono text-[10px] font-semibold tracking-wider transition-colors ${b.border} ${b.bg} ${b.text} hover:brightness-110`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${b.dotBg}`} aria-hidden />
          {idx}
        </a>,
      );
    } else {
      parts.push(
        <span key={`${id}-${match.index}`} className="font-mono text-[10px] text-zinc-400">
          [?]
        </span>,
      );
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

function CitationCard({ index, cite }: { index: number; cite: CanonCitation }) {
  const excerpt = cite.sourceExcerpt
    ? cite.sourceExcerpt.replace(/\s+/g, ' ').trim().slice(0, 200)
    : null;
  return (
    <div
      id={`cite-${index}`}
      className="scroll-mt-24 rounded-lg border border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/60"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold tabular-nums text-zinc-500">
            [{index}]
          </span>
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {cite.entity}
            {cite.metricKey ? (
              <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {cite.metricKey}
              </span>
            ) : null}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <BrandChip sourceRef={cite.sourceRef} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            signed {cite.signedAt.toISOString().slice(0, 10)}
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-sm text-zinc-800 dark:text-zinc-200">
        {cite.claim}
      </p>
      {excerpt && (
        <p className="mt-1 border-l-2 border-zinc-300 pl-2 text-xs italic text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          “{excerpt}”
        </p>
      )}
      <p className="mt-1 break-all font-mono text-[9px] text-zinc-400">
        factId={cite.factId} · eventHash={cite.eventHash.slice(0, 16)}…
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * ExternalContextSection — UNSIGNED public-web context (Tavily). User-
 * triggered "Search web for context →" button under every AskCanon answer.
 *
 * Trust gradient is the load-bearing visual: sky-blue panel + UNSIGNED
 * badges on every item, explicitly contrasted against the signed citations
 * above. Architectural invariant: every item carries `unsigned: true` from
 * tavily.ts — UI just surfaces it loudly so the user can never confuse
 * web hearsay with signed truth.
 *
 * Caching + 12/min rate-limit live in src/lib/canon/web-context.ts so this
 * UI cannot accidentally burn the day's Tavily quota during demo rehearsal.
 * -------------------------------------------------------------------------- */
function ExternalContextSection({ question }: { question: string }) {
  const [data, setData] = useState<WebContextResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function fetchTavily() {
    const q = question.trim();
    if (!q) return;
    setError(null);
    start(async () => {
      const res = await searchWebContextAction({ query: q });
      if ('error' in res) {
        setError(res.error);
      } else {
        setData(res);
      }
    });
  }

  // Idle state — small button only. Keeps the answer scannable; user opts
  // in when they want to compare signed vs unsigned for this question.
  if (!data && !pending && !error) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={fetchTavily}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-sky-400 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900 shadow-sm transition-colors hover:bg-sky-100 hover:shadow dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-900/60"
        >
          <span aria-hidden className="text-lg">⌕</span>
          <span>Compare with the public web</span>
          <span className="rounded-full border border-sky-500 bg-sky-200 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-sky-900 dark:border-sky-400 dark:bg-sky-900/60 dark:text-sky-100">
            UNSIGNED
          </span>
          <span aria-hidden className="opacity-60">→</span>
        </button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-sky-300 bg-gradient-to-br from-sky-50 to-white p-4 dark:border-sky-700/50 dark:from-sky-950/30 dark:to-zinc-950">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">
            external context · Tavily
          </p>
          <span className="rounded-full border border-sky-400 bg-sky-100 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-sky-900 dark:border-sky-500 dark:bg-sky-900/40 dark:text-sky-100">
            UNSIGNED
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setData(null);
            setError(null);
          }}
          className="font-mono text-[10px] uppercase tracking-wider text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
          aria-label="Close external context"
        >
          ×
        </button>
      </header>

      {/* Trust-gradient subtitle — names the limitation up-front so a
          mis-disambiguated web hit (e.g. "PLC = Programmable Logic
          Controller" returned for "Bright Plc") teaches the audience
          why signed > unsigned, not "Tavily is broken". */}
      <p className="mt-2 text-[11px] leading-snug text-sky-800/90 dark:text-sky-200/80">
        Web-search by name — may surface unrelated entities with the same
        name. The signed answer above is verified; everything below is
        best-effort hearsay.
        {data && data.wasEnhanced && (
          <span className="block mt-1 font-mono text-[10px] text-sky-700/70 dark:text-sky-300/60">
            query sent to Tavily: <span className="text-sky-900 dark:text-sky-100">“{data.effectiveQuery}”</span> (we appended “company” because we recognised an entity)
          </span>
        )}
      </p>

      {pending && (
        <p className="mt-2 font-mono text-[11px] text-sky-700 dark:text-sky-300">
          Querying Tavily…
        </p>
      )}

      {error && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-700/50 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchTavily}
            className="font-mono text-[10px] font-semibold uppercase tracking-wider underline-offset-2 hover:underline"
          >
            retry
          </button>
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-3">
          {data.synthesis && (
            <blockquote className="border-l-2 border-sky-400 pl-3 text-sm italic leading-snug text-sky-900 dark:text-sky-100">
              “{data.synthesis}”
              <p className="mt-1 not-italic font-mono text-[10px] uppercase tracking-wider text-sky-700/70 dark:text-sky-300/60">
                Tavily synthesis · {data.latencyMs}ms{data.cached ? ' · cached' : ''}
              </p>
            </blockquote>
          )}
          {data.items.length === 0 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Tavily returned no public-web results for this query.
            </p>
          )}
          {data.items.length > 0 && (
            <ul className="space-y-2">
              {data.items.slice(0, 5).map((it) => {
                let host = '';
                try {
                  host = new URL(it.url).hostname;
                } catch {
                  host = '';
                }
                return (
                  <li
                    key={it.url}
                    className="rounded-lg border border-sky-200 bg-white/60 p-2.5 dark:border-sky-800/40 dark:bg-zinc-900/40"
                  >
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm font-medium text-sky-900 hover:underline dark:text-sky-100"
                    >
                      {it.title}
                    </a>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-zinc-700 dark:text-zinc-300">
                      {it.excerpt}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-sky-700 dark:text-sky-400">
                      <span>{host}</span>
                      {typeof it.relevance === 'number' && (
                        <span>· relevance {it.relevance.toFixed(2)}</span>
                      )}
                      {it.publishedAt && <span>· {it.publishedAt.slice(0, 10)}</span>}
                      <span className="rounded border border-sky-400 bg-sky-100 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-sky-900 dark:border-sky-500 dark:bg-sky-900/40 dark:text-sky-100">
                        unsigned
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
