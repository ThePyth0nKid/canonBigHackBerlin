import {
  getCanonCustomRuleStatus,
  type CanonCustomRuleStatus,
} from '@/lib/canon/aikido';

/**
 * Layer 3 — trust-gate banner.
 *
 * The rule is authored in Semgrep YAML at `.semgrep/canon-trust-gate.yml`
 * and runs on Opengrep, the open-source Semgrep CE fork backed by a
 * 10-org AppSec consortium of which Aikido is a founding member
 * (alongside Arnica, Amplify, Endor Labs, Jit, Kodem, Legit, Mobb,
 * Orca, Phoenix). Same grammar Aikido's hosted SAST runs on — pitch
 * is "Aikido scans the repo (top banner) AND we run our own custom
 * rules on the same engine family Aikido helps maintain (bottom
 * banner)" without overclaim.
 *
 * The rule-side counts below are inlined as constants — the rule file
 * lives in the repo and only changes when we deliberately edit it, so
 * a runtime fs.readFile would just be ceremony. **Keep these in sync
 * with `.semgrep/canon-trust-gate.yml`** if you add/remove rules,
 * patterns, or excludes.
 *
 * The Aikido side is fetched live every 30s (workspace + tracked
 * repo from the public REST API) so the "Aikido watches this repo"
 * claim is data-bound and can never go stale.
 */

const OPENGREP_VERSION = '1.20.0';

const RULE_INFO = {
  ruleCount: 3,
  patternCount: 29,
  hasTaintRule: true,
  hasRawSqlRule: true,
  uniqueExcludes: 13,
} as const;

const COVERAGE = ['direct write', 'aliased / destructured', 'raw SQL'] as const;

const AIKIDO_TTL_MS = 30_000;
let aikidoCache:
  | { at: number; promise: Promise<CanonCustomRuleStatus> }
  | null = null;

function getAikidoStatus(): Promise<CanonCustomRuleStatus> {
  const now = Date.now();
  if (aikidoCache && now - aikidoCache.at < AIKIDO_TTL_MS) return aikidoCache.promise;
  const promise = getCanonCustomRuleStatus();
  aikidoCache = { at: now, promise };
  promise.catch(() => {
    if (aikidoCache?.promise === promise) aikidoCache = null;
  });
  return promise;
}

export async function TrustGateBanner() {
  let aikido: CanonCustomRuleStatus | null = null;
  try {
    aikido = await getAikidoStatus();
  } catch {
    // Banner still renders with rule-side data — Aikido offline is OK.
  }

  return (
    <details className="group rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
        <span className="relative inline-flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-500">
          aikido · opengrep
        </span>
        <span className="text-zinc-700 dark:text-zinc-300">
          canon-trust-gate /{' '}
          <span className="font-medium">{RULE_INFO.ruleCount} rules</span>
        </span>
        <span className="text-zinc-400">·</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          enforced in ci · {RULE_INFO.patternCount} patterns
        </span>
        <span
          aria-hidden
          className="ml-1 select-none text-zinc-400 transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <p className="text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          Custom Semgrep-grammar rule that runs on{' '}
          <span className="font-medium">Opengrep v{OPENGREP_VERSION}</span> —
          the open-source SAST engine{' '}
          <span className="font-medium">backed by a 10-org AppSec consortium</span>{' '}
          (Aikido is a founding member). Same grammar Aikido&apos;s hosted
          scanner uses, executed locally + in CI. Every{' '}
          <code className="font-mono text-[10.5px]">FactEvent</code> write
          outside <code className="font-mono text-[10.5px]">runPipeline()</code>{' '}
          (or the resolve.ts <code className="font-mono text-[10.5px]">CanonSigner</code>{' '}
          path) — including aliased, destructured, reflected, cast and raw-SQL
          bypass attempts — trips a high-severity finding before merge. Ed25519
          + hash-chain audit trail can&apos;t be silently bypassed.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <RuleCard
            heading="rule · opengrep"
            link={{ label: 'opengrep.dev →', href: 'https://opengrep.dev/' }}
            rows={[
              ['engine', `opengrep v${OPENGREP_VERSION}`],
              ['rules', String(RULE_INFO.ruleCount)],
              ['match patterns', String(RULE_INFO.patternCount)],
              ['coverage', COVERAGE.join(' + ')],
              ['audited paths', String(RULE_INFO.uniqueExcludes)],
            ]}
            footer="source · .semgrep/canon-trust-gate.yml · npm run trust-gate"
          />
          <RuleCard
            heading="aikido · hosted"
            link={
              aikido
                ? { label: 'open workspace →', href: aikido.repoListUrl }
                : null
            }
            rows={
              aikido
                ? [
                    ['workspace', aikido.workspaceName],
                    ['tracked repo', aikido.repoName],
                    ['scanner', 'aikido hosted SAST + DAST + OSS'],
                    ['link', 'shares engine family with rule (Opengrep)'],
                  ]
                : [['status', 'aikido api offline']]
            }
            footer={
              aikido
                ? `live · last fetched ${new Date(aikido.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : null
            }
          />
        </div>
      </div>
    </details>
  );
}

function RuleCard({
  heading,
  rows,
  link,
  footer,
}: {
  heading: string;
  rows: Array<[string, string]>;
  link: { label: string; href: string } | null;
  footer: string | null;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          {heading}
        </span>
        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] uppercase tracking-wider text-sky-700 hover:underline dark:text-sky-400"
          >
            {link.label}
          </a>
        )}
      </div>
      <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="text-zinc-700 dark:text-zinc-300">{v}</dd>
          </div>
        ))}
      </dl>
      {footer && (
        <p className="mt-1.5 font-mono text-[9.5px] text-zinc-400">{footer}</p>
      )}
    </div>
  );
}
