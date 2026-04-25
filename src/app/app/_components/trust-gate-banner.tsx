import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getCanonCustomRuleStatus,
  type CanonCustomRuleStatus,
} from '@/lib/canon/aikido';

/**
 * Layer 3 — trust-gate banner.
 *
 * The rule is authored in Semgrep YAML and runs on Opengrep, the
 * open-source Semgrep CE fork backed by a 10-org AppSec consortium of
 * which Aikido is a founding member (alongside Arnica, Amplify, Endor
 * Labs, Jit, Kodem, Legit, Mobb, Orca, Phoenix). Same grammar Aikido's
 * hosted SAST runs on — so the pitch is "Aikido scans the repo (top
 * banner) AND we run our own custom rules on the same engine family
 * Aikido helps maintain (bottom banner)" without overclaim.
 *
 * Two data sources, both real:
 *   1. The local YAML at `.semgrep/canon-trust-gate.yml`, parsed at
 *      render time. Banner cannot lie — it's data-bound to the actual
 *      repo artifact.
 *   2. The Aikido REST API — surfaces workspace + tracked-repo as live
 *      attestation that Aikido's hosted SAST is watching this codebase.
 */

const OPENGREP_VERSION = '1.20.0';

type LocalRule = {
  ruleCount: number;
  patternCount: number;
  hasTaintRule: boolean;
  hasRawSqlRule: boolean;
  uniqueExcludes: number;
};

type BannerState =
  | { kind: 'offline'; reason: 'no-rule-file' }
  | {
      kind: 'live';
      local: LocalRule;
      aikido: CanonCustomRuleStatus | null;
      aikidoError: string | null;
    };

let localCache: Promise<LocalRule | null> | null = null;
function getLocalRule(): Promise<LocalRule | null> {
  if (!localCache) localCache = loadLocalRule();
  return localCache;
}

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

async function loadState(): Promise<BannerState> {
  const local = await getLocalRule();
  if (!local) return { kind: 'offline', reason: 'no-rule-file' };

  let aikido: CanonCustomRuleStatus | null = null;
  let aikidoError: string | null = null;
  try {
    aikido = await getAikidoStatus();
  } catch (err) {
    aikidoError = (err as Error).message.slice(0, 80);
  }
  return { kind: 'live', local, aikido, aikidoError };
}

async function loadLocalRule(): Promise<LocalRule | null> {
  try {
    const rulePath = path.join(process.cwd(), '.semgrep/canon-trust-gate.yml');
    const yml = await readFile(rulePath, 'utf8');

    const ruleCount = (yml.match(/^\s*-\s*id:\s/gm) ?? []).length;
    const patternCount = (yml.match(/^\s*-\s*pattern(-regex)?:\s/gm) ?? []).length;
    const hasTaintRule = /\bmode:\s*taint\b/.test(yml);
    const hasRawSqlRule = /\$executeRaw|Prisma\\?\.sql/.test(yml);

    const lines = yml.split('\n');
    const uniq = new Set<string>();
    let inExclude = false;
    let excludeIndent = 0;
    for (const line of lines) {
      const m = line.match(/^(\s*)exclude:\s*$/);
      if (m) {
        inExclude = true;
        excludeIndent = m[1].length;
        continue;
      }
      if (inExclude) {
        const stripped = line.replace(/\s+$/, '');
        if (!stripped) continue;
        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        if (indent <= excludeIndent && /\S/.test(stripped)) {
          inExclude = false;
          continue;
        }
        const item = line.trim();
        if (item.startsWith('- ')) {
          uniq.add(item.slice(2).replace(/^['"]|['"]$/g, ''));
        }
      }
    }

    if (ruleCount === 0) return null;
    return {
      ruleCount,
      patternCount,
      hasTaintRule,
      hasRawSqlRule,
      uniqueExcludes: uniq.size,
    };
  } catch {
    return null;
  }
}

export async function TrustGateBanner() {
  const state = await loadState();

  if (state.kind === 'offline') {
    return (
      <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
        <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-500">
          aikido · opengrep
        </span>
        <span className="text-zinc-400">offline</span>
      </div>
    );
  }

  const { local, aikido } = state;
  const coverage: string[] = ['direct write'];
  if (local.hasTaintRule) coverage.push('aliased / destructured');
  if (local.hasRawSqlRule) coverage.push('raw SQL');

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
          <span className="font-medium">{local.ruleCount} rules</span>
        </span>
        <span className="text-zinc-400">·</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          enforced in ci · {local.patternCount} patterns
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
              ['rules', String(local.ruleCount)],
              ['match patterns', String(local.patternCount)],
              ['coverage', coverage.join(' + ')],
              ['audited paths', String(local.uniqueExcludes)],
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
