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
}

export interface AikidoBanner {
  workspaceName: string;
  repoName: string;
  repoActive: boolean;
  totalIssues: number;
  criticalIssues: number;
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

/** One-call repo-health summary for the /app banner. */
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
    ? issues.filter((i) => i.repository_id === repo.id)
    : issues;
  const critical = repoIssues.filter(
    (i) => (i.severity ?? '').toLowerCase() === 'critical',
  ).length;
  return {
    workspaceName: ws.name,
    repoName: repo?.name ?? target,
    repoActive: repo?.active ?? false,
    totalIssues: repoIssues.length,
    criticalIssues: critical,
    fetchedAt: new Date().toISOString(),
  };
}
