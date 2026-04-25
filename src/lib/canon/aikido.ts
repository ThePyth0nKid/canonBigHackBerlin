/**
 * Aikido Security client — Layer 3 companion to scan.ts.
 *
 * Two roles in Canon:
 *   1. OAuth-token-cached health-banner data for the UI:
 *      "Source: canonBigHackBerlin · Aikido-monitored · 0 issues".
 *      Recursive trust narrative: Canon's *own* code is Aikido-clean.
 *   2. Future Path A: programmatic AIK_CI_* token mint via access_tokens:write
 *      (endpoint path not publicly documented yet — booth-question).
 *
 * Auth: OAuth2 client_credentials → JWT, expires_in ≈ 3600s. We cache it.
 */

const AIKIDO_BASE = 'https://app.aikido.dev';
const TOKEN_PATH = '/api/oauth/token';

const TRACKED_REPO = 'canonBigHackBerlin';

interface TokenCacheEntry {
  token: string;
  /** Epoch seconds at which we should refresh (a 60s safety margin). */
  refreshAt: number;
}

let tokenCache: TokenCacheEntry | null = null;
let inflightToken: Promise<string> | null = null;

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface WorkspaceResp {
  id: number;
  name: string;
  linked_provider?: string;
}

interface RepoResp {
  id: number;
  name: string;
  provider?: string;
  active?: boolean;
  url?: string;
}

interface IssueResp {
  id?: number | string;
  severity_score?: number;
  severity?: string;
  status?: string;
  type?: string;
  repository_id?: number;
  code_repo_id?: number;
  code_repo_name?: string;
  rule?: string | null;
  rule_id?: string | null;
  affected_file?: string;
  affected_package?: string;
  cve_id?: string;
  cwe_classes?: string[];
}

export interface AikidoIssueSummary {
  id: number | string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown';
  status: 'open' | 'ignored' | 'closed' | 'unknown';
  type: string;
  rule: string | null;
  affectedFile: string | null;
  affectedPackage: string | null;
  cveId: string | null;
}

export interface AikidoBanner {
  workspaceName: string;
  repoName: string;
  repoActive: boolean;
  /** All issues assigned to this repo (open + ignored + closed). */
  totalIssues: number;
  openCritical: number;
  openHigh: number;
  openMedium: number;
  openLow: number;
  ignored: number;
  closed: number;
  /** Categorized counts for the banner's mini-chart. */
  byType: Record<string, number>;
  /** Up to 5 most-severe open issues for tooltip / drill-down. */
  topOpen: AikidoIssueSummary[];
  fetchedAt: string;
}

export class AikidoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AikidoError';
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.refreshAt > nowSec()) return tokenCache.token;
  if (inflightToken) return inflightToken;

  inflightToken = (async () => {
    const id = process.env.AIKIDO_CLIENT_ID;
    const secret = process.env.AIKIDO_CLIENT_SECRET;
    if (!id || !secret) throw new AikidoError('AIKIDO_CLIENT_ID/SECRET not set');

    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await fetch(`${AIKIDO_BASE}${TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new AikidoError(
        `Aikido token ${res.status}: ${(await res.text()).slice(0, 160)}`,
        res.status,
      );
    }
    const data = (await res.json()) as OAuthTokenResponse;
    tokenCache = {
      token: data.access_token,
      refreshAt: nowSec() + Math.max(60, data.expires_in - 60),
    };
    return data.access_token;
  })().finally(() => {
    inflightToken = null;
  });

  return inflightToken;
}

async function aikidoGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${AIKIDO_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 240);
    throw new AikidoError(`Aikido ${path} ${res.status}: ${body}`, res.status);
  }
  return (await res.json()) as T;
}

export async function getWorkspace(): Promise<WorkspaceResp> {
  return aikidoGet<WorkspaceResp>('/api/public/v1/workspace');
}

export async function getTrackedRepos(): Promise<RepoResp[]> {
  return aikidoGet<RepoResp[]>('/api/public/v1/repositories/code');
}

export async function getOpenIssues(): Promise<IssueResp[]> {
  // /issues/export returns a flat issue array. May be [] for clean repos.
  return aikidoGet<IssueResp[]>('/api/public/v1/issues/export');
}

/** One-call repo-health summary for the /app banner — full triage shape. */
export async function getRepoBanner(opts?: {
  repoName?: string;
}): Promise<AikidoBanner> {
  const target = opts?.repoName ?? TRACKED_REPO;
  const [ws, repos, issues] = await Promise.all([
    getWorkspace(),
    getTrackedRepos(),
    getOpenIssues(),
  ]);
  const repo = repos.find((r) => r.name === target);
  const repoIssues = repo
    ? issues.filter(
        (i) => i.code_repo_id === repo.id || i.repository_id === repo.id,
      )
    : issues;

  let openCritical = 0;
  let openHigh = 0;
  let openMedium = 0;
  let openLow = 0;
  let ignored = 0;
  let closed = 0;
  const byType: Record<string, number> = {};

  for (const i of repoIssues) {
    const sev = (i.severity ?? '').toLowerCase();
    const st = (i.status ?? '').toLowerCase();
    const ty = i.type ?? 'unknown';
    byType[ty] = (byType[ty] ?? 0) + 1;
    if (st === 'ignored') ignored++;
    else if (st === 'closed') closed++;
    else if (st === 'open') {
      if (sev === 'critical') openCritical++;
      else if (sev === 'high') openHigh++;
      else if (sev === 'medium') openMedium++;
      else openLow++;
    }
  }

  const topOpen: AikidoIssueSummary[] = repoIssues
    .filter((i) => (i.status ?? '').toLowerCase() === 'open')
    .sort((a, b) => (b.severity_score ?? 0) - (a.severity_score ?? 0))
    .slice(0, 5)
    .map((i) => ({
      id: i.id ?? '?',
      severity: normalizeSeverity(i.severity),
      status: 'open',
      type: i.type ?? 'unknown',
      rule: i.rule ?? null,
      affectedFile: i.affected_file ?? null,
      affectedPackage: i.affected_package ?? null,
      cveId: i.cve_id ?? null,
    }));

  return {
    workspaceName: ws.name,
    repoName: repo?.name ?? target,
    repoActive: repo?.active ?? false,
    totalIssues: repoIssues.length,
    openCritical,
    openHigh,
    openMedium,
    openLow,
    ignored,
    closed,
    byType,
    topOpen,
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeSeverity(s: string | undefined): AikidoIssueSummary['severity'] {
  const v = (s ?? '').toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low' || v === 'info') {
    return v;
  }
  return 'unknown';
}

function normalizeStatus(s: string | undefined): AikidoIssueSummary['status'] {
  const v = (s ?? '').toLowerCase();
  if (v === 'open' || v === 'ignored' || v === 'closed') return v;
  return 'unknown';
}

/* -------------------------------------------------------------------------- *
 * Custom-rule attestation — surfaces, via Aikido's read-only public API,
 * (a) that the canonBigHackBerlin repo is tracked by Aikido's hosted
 * scanner and (b) any findings whose `rule_id` starts with `canon-`
 * (our SAST namespace). On Pro-Trial workspaces, custom-rule upload is
 * gated, so `canonRuleIds` will be empty — the function still returns
 * the live workspace + repo as proof Aikido is watching the repo.
 * -------------------------------------------------------------------------- */

export interface CanonCustomRuleStatus {
  workspaceName: string;
  workspaceId: number;
  repoName: string;
  repoId: number | null;
  /** Safe top-level deep-link (verified — `/repositories/code/<id>/issues` 404'd). */
  repoListUrl: string;
  /** Top-level Code Quality area in the Aikido sidebar. */
  codeQualityUrl: string;
  /** Issues whose rule_id starts with `canon-` (our SAST rule namespace). */
  canonIssues: AikidoIssueSummary[];
  /** Distinct rule_ids seen — proxy for "uploaded rules" if Pro is ever enabled. */
  canonRuleIds: string[];
  fetchedAt: string;
}

const CANON_RULE_PREFIX = 'canon-';

export async function getCanonCustomRuleStatus(opts?: {
  repoName?: string;
}): Promise<CanonCustomRuleStatus> {
  const target = opts?.repoName ?? TRACKED_REPO;
  const [ws, repos, issues] = await Promise.all([
    getWorkspace(),
    getTrackedRepos(),
    getOpenIssues(),
  ]);
  const repo = repos.find((r) => r.name === target);

  const canonRaw = issues.filter((i) =>
    (i.rule_id ?? '').toLowerCase().startsWith(CANON_RULE_PREFIX),
  );
  const canonIssues: AikidoIssueSummary[] = canonRaw.map((i) => ({
    id: i.id ?? '?',
    severity: normalizeSeverity(i.severity),
    status: normalizeStatus(i.status),
    type: i.type ?? 'sast',
    rule: i.rule ?? i.rule_id ?? null,
    affectedFile: i.affected_file ?? null,
    affectedPackage: i.affected_package ?? null,
    cveId: i.cve_id ?? null,
  }));
  const canonRuleIds = Array.from(
    new Set(canonRaw.map((i) => i.rule_id ?? '').filter(Boolean)),
  );

  return {
    workspaceName: ws.name,
    workspaceId: ws.id,
    repoName: repo?.name ?? target,
    repoId: repo?.id ?? null,
    repoListUrl: 'https://app.aikido.dev/repositories',
    codeQualityUrl: 'https://app.aikido.dev/code-quality',
    canonIssues,
    canonRuleIds,
    fetchedAt: new Date().toISOString(),
  };
}
