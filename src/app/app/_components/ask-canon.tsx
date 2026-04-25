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
 */

import { useState, useTransition } from 'react';
import { askCanonAction } from '../_actions/ask-canon';
import type { CanonAnswer, CanonCitation } from '@/lib/canon/ask';

const SUGGESTIONS = [
  'What\'s the conflict on Miller Group?',
  'Which products have a corroborated price?',
  'Who is the primary contact at Gonzalez Inc?',
  'What\'s Bright Plc\'s relationship type?',
] as const;

export function AskCanon() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<CanonAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setError(null);
    start(async () => {
      const res = await askCanonAction({ question: trimmed });
      if ('error' in res) setError(res.error);
      else {
        setAnswer(res);
        setError(null);
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
        <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-700/50 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {answer && !pending && <AnswerBlock answer={answer} />}
    </div>
  );
}

function AnswerBlock({ answer }: { answer: CanonAnswer }) {
  const tone =
    answer.confidence === 'high'
      ? { label: 'high confidence', color: 'text-emerald-700 dark:text-emerald-400' }
      : answer.confidence === 'medium'
        ? { label: 'medium confidence', color: 'text-amber-700 dark:text-amber-400' }
        : { label: 'low confidence', color: 'text-zinc-500 dark:text-zinc-400' };

  // Build a citation lookup keyed by factId so we can render inline
  // [f_XXX] tokens in the answer as anchored links to the cards below.
  const citationById = new Map(answer.citations.map((c) => [c.factId, c]));

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="text-violet-700 dark:text-violet-300">
          Gemini · 2.5-flash · {answer.latencyMs}ms · scanned {answer.retrievedCount} facts
        </span>
        <span className={tone.color}>{tone.label}</span>
      </div>
      <p className="text-sm leading-relaxed text-zinc-900 dark:text-zinc-100">
        {renderAnswerWithCitations(answer.answer, citationById)}
      </p>
      {answer.citations.length > 0 && (
        <div className="mt-2 grid gap-2">
          {answer.citations.map((c, i) => (
            <CitationCard key={c.factId} index={i + 1} cite={c} />
          ))}
        </div>
      )}
    </div>
  );
}

const CITATION_RE = /\[(f_[A-Za-z0-9]+)\]/g;

function renderAnswerWithCitations(
  text: string,
  byId: Map<string, CanonCitation>,
): React.ReactNode[] {
  // Walk the text, replace [f_XXX] tokens with little anchor pills that
  // link to the citation card below (#cite-N). Unknown ids render as
  // muted text — they were stripped server-side, so this is just defence.
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
    if (idx) {
      parts.push(
        <a
          key={`${id}-${match.index}`}
          href={`#cite-${idx}`}
          className="inline-flex items-baseline rounded bg-violet-100 px-1 py-px font-mono text-[10px] font-semibold tracking-wider text-violet-800 hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-200 dark:hover:bg-violet-900/80"
        >
          [{idx}]
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
  const kind = cite.sourceRef.split(':', 1)[0];
  const excerpt = cite.sourceExcerpt
    ? cite.sourceExcerpt.replace(/\s+/g, ' ').trim().slice(0, 200)
    : null;
  return (
    <div
      id={`cite-${index}`}
      className="scroll-mt-20 rounded-lg border border-violet-200 bg-white/70 p-3 dark:border-violet-700/40 dark:bg-zinc-900/60"
    >
      <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-wider">
        <span className="text-violet-700 dark:text-violet-300">
          [{index}] {cite.entity}
          {cite.metricKey ? ` · ${cite.metricKey}` : ''}
        </span>
        <span className="text-zinc-500">
          {kind} · signed {cite.signedAt.toISOString().slice(0, 10)}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">{cite.claim}</p>
      {excerpt && (
        <p className="mt-1 border-l-2 border-violet-300 pl-2 text-xs italic text-zinc-600 dark:border-violet-700/50 dark:text-zinc-400">
          “{excerpt}”
        </p>
      )}
      <p className="mt-1 break-all font-mono text-[9px] text-zinc-500">
        factId={cite.factId} · eventHash={cite.eventHash.slice(0, 16)}…
      </p>
    </div>
  );
}
