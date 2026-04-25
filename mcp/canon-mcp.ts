#!/usr/bin/env -S npx tsx
/**
 * Canon MCP server — exposes signed facts (FactEvent rows) to AI agents
 * over the Model Context Protocol via stdio.
 *
 * Tools:
 *   canon_lookup           — all active facts for an entity (slug)
 *   canon_search           — free-text substring match across all active facts
 *   canon_cite             — full audit-chain proof for a single factId
 *   canon_diff             — facts created/changed since an ISO date  (stub-light: time-window)
 *   canon_external_lookup  — UNSIGNED public-web context via Tavily (signed/unsigned split)
 *   canon_write            — propose a new fact (NOT IMPLEMENTED in v0.1)
 *
 * Demo workspace = the most-recently-created User. Default workspace = inazuma
 * (post-pivot single-workspace world; clients/vendors/products/sales/policies
 * + live Slack/Gmail/PDF feeds all live there).
 *
 * Run:
 *   npx tsx mcp/canon-mcp.ts
 *
 * Inspect:
 *   npx @modelcontextprotocol/inspector npx tsx mcp/canon-mcp.ts
 */

// Load env from the project's own .env / .env.local — not from cwd, because
// the MCP server is registered at user scope and may be spawned from any
// directory (e.g. ~). __dirname-relative paths keep DATABASE_URL etc. resolvable.
// quiet:true is critical — dotenv v17 emits "◇ injected env" lines on stdout
// by default, which breaks MCP (stdout must be pure JSON-RPC).
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '..', '.env'), quiet: true });
loadDotenv({ path: resolve(__dirname, '..', '.env.local'), override: true, quiet: true });

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchExternal } from '../src/lib/canon/tavily.js';
// Shared search lib — same retrieval+ranking the Ask-Canon UI uses, so
// MCP agents and the in-app box give bit-identical results. Critical for
// the demo claim "you can ask via UI OR via Claude Code MCP — same code".
import { searchFacts as sharedSearchFacts } from '../src/lib/canon/search.js';
// Use the same prisma singleton the Next.js app uses so both processes
// (Next dev/prod + MCP server) don't each spawn their own pool inside the
// same node instance when MCP delegates to shared libs.
import { prisma } from '../src/lib/prisma.js';

// Prisma client comes from the shared @/lib/prisma singleton (imported
// above). Originally MCP spun up its own PrismaClient — that was fine when
// MCP was self-contained, but now that we share search/lookup code with the
// Next app, two pools in the same node process is wasteful and fights for
// connections. One singleton, one pool.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_DISPLAY: Record<string, string> = {
  // Inazuma cast — primary workspace post-pivot. Demo-gold entities have
  // built-in industry conflicts + dual-role corroboration to drive the demo.
  inazuma: 'Inazuma.co',
  miller_group: 'Miller Group',
  gonzalez_inc: 'Gonzalez Inc',
  johnson_group: 'Johnson Group',
  huang_llc: 'Huang LLC',
  williams_group: 'Williams Group',
  martin_ltd: 'Martin Ltd',
  // Northwind cast — legacy demo. Kept so canon_lookup against an old slug
  // still returns a friendly display name if any pre-pivot facts surface.
  northwind: 'Northwind Software',
  acme: 'ACME GmbH',
  techco: 'TechCo',
  globex: 'Globex',
  initech: 'Initech',
  umbrella: 'Umbrella',
  soylent: 'Soylent',
};

function entityDisplay(slug: string): string {
  return ENTITY_DISPLAY[slug] ?? slug;
}

function shortHash(h: string | null | undefined): string {
  if (!h) return '∅';
  return h.length > 12 ? `${h.slice(0, 12)}…` : h;
}

function sourceKindOf(sourceRef: string): string {
  return sourceRef.split(':', 1)[0] ?? 'unknown';
}

function textBlock(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorBlock(msg: string) {
  return { content: [{ type: 'text' as const, text: `error: ${msg}` }], isError: true };
}

/** Cached demo workspace user-id (resolved at boot). */
let DEMO_USER_ID: string | null = null;

async function resolveDemoUserId(): Promise<string> {
  if (DEMO_USER_ID) return DEMO_USER_ID;
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!user) throw new Error('no users in database — run the seed first');
  DEMO_USER_ID = user.id;
  return user.id;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

// Post-pivot: single-workspace world. The `workspace` argument is kept on
// the tool schemas for back-compat with any agent prompts that still pass it,
// but it's normalised to the only live workspace. If you ever introduce a
// second workspace later, just re-broaden this default.
const DEFAULT_WORKSPACE = 'inazuma';

function normalizeWorkspace(input: string | undefined): string {
  const v = (input ?? DEFAULT_WORKSPACE).trim().toLowerCase();
  return v || DEFAULT_WORKSPACE;
}

async function canonLookup(entityArg: string, workspace?: string) {
  const userId = await resolveDemoUserId();
  const ws = normalizeWorkspace(workspace);
  const slug = entityArg.trim().toLowerCase();
  if (!slug) return errorBlock('entity is required');

  const rows = await prisma.factEvent.findMany({
    where: { userId, workspace: ws, entity: slug, status: 'active' },
    orderBy: { signedAt: 'asc' },
    // Pull signerPubkey + parentHash + sourceExcerpt so the formatter can
    // render the trust footer (chain integrity) AND the verbatim source
    // line for each fact — agents (and the human reading the answer) get
    // both the cryptographic provenance AND the human-readable source
    // text without a follow-up canon_cite round-trip.
    select: {
      id: true, entity: true, claim: true, sourceRef: true,
      signedAt: true, eventHash: true, signerPubkey: true, parentHash: true,
      sourceExcerpt: true,
    },
  });

  if (rows.length === 0) {
    // Fallback: case-insensitive contains, in case the agent passed display name.
    const fuzzy = await prisma.factEvent.findMany({
      where: {
        userId,
        workspace: ws,
        status: 'active',
        entity: { contains: slug, mode: 'insensitive' },
      },
      orderBy: { signedAt: 'asc' },
      take: 50,
      select: {
        id: true, entity: true, claim: true, sourceRef: true,
        signedAt: true, eventHash: true, signerPubkey: true, parentHash: true,
        sourceExcerpt: true,
      },
    });
    if (fuzzy.length === 0) {
      const known = await listKnownEntities(userId, ws);
      return textBlock(
        `No facts found for entity "${entityArg}". ` +
          `Known entities (sample): ${known.slice(0, 30).join(', ')}` +
          (known.length > 30 ? ` (+${known.length - 30} more)` : '') +
          `. Try canon_search({query}) for free-text instead.`,
      );
    }
    return textBlock(formatLookup(slug, ws, fuzzy));
  }

  return textBlock(formatLookup(slug, ws, rows));
}

async function listKnownEntities(userId: string, workspace: string): Promise<string[]> {
  const distinct = await prisma.factEvent.findMany({
    where: { userId, workspace, status: 'active' },
    select: { entity: true },
    distinct: ['entity'],
  });
  return distinct.map((d) => d.entity);
}

async function canonWorkspaces() {
  const userId = await resolveDemoUserId();
  const counts = await prisma.factEvent.groupBy({
    by: ['workspace'],
    where: { userId, status: 'active' },
    _count: { _all: true },
  });
  if (counts.length === 0) {
    return textBlock(
      'No facts in the ledger yet. Run the seed/ingest scripts or click Sync on canon.ultranova.io.',
    );
  }
  const lines: string[] = [];
  lines.push('# Canon ledger summary');
  lines.push('');
  for (const c of counts.sort((a, b) => b._count._all - a._count._all)) {
    // Post-pivot the only live workspace is `inazuma`. Stale `northwind`
    // rows from the legacy demo would still surface here for audit clarity.
    const label =
      c.workspace === 'inazuma'
        ? 'Inazuma.co (live · D2C consumer-electronics, full org dataset)'
        : `${c.workspace} (legacy / pre-pivot)`;
    lines.push(`- **${c.workspace}** · ${c._count._all} active facts · ${label}`);
  }
  lines.push('');
  lines.push(
    'Workspace param is optional on canon_lookup / canon_search / canon_diff — defaults to "inazuma".',
  );
  return textBlock(lines.join('\n'));
}

interface FactRowForFormat {
  id: string;
  entity: string;
  claim: string;
  sourceRef: string;
  sourceExcerpt: string | null;
  signedAt: Date;
  eventHash: string;
  signerPubkey: string;
  parentHash: string | null;
}

function formatLookup(slug: string, workspace: string, rows: FactRowForFormat[]): string {
  const display = entityDisplay(slug);
  const lines: string[] = [];
  lines.push(`# Canon facts about ${display} (${slug}) — ${rows.length} active signed fact(s) · workspace: ${workspace}`);
  lines.push('');
  lines.push(
    'Each fact is Ed25519-signed and hash-chained. ALWAYS preserve the [signed] line + ' +
      '[source] line when surfacing facts to the user — those are the trust signal. The audit ' +
      'footer at the bottom is the chain integrity summary.',
  );
  lines.push('');
  for (const r of rows) {
    const kind = sourceKindOf(r.sourceRef);
    const excerpt = r.sourceExcerpt
      ? r.sourceExcerpt.replace(/\s+/g, ' ').trim().slice(0, 220)
      : null;
    lines.push(
      `- ${r.claim}\n` +
        `  [source] ${kind} · ${r.sourceRef}` +
        (excerpt ? `\n  [excerpt] "${excerpt}${excerpt.length === 220 ? '…' : ''}"` : '') +
        `\n  [signed] ${r.signedAt.toISOString()} · factId=${r.id}` +
        `\n  [crypto] eventHash=${shortHash(r.eventHash)} · parent=${shortHash(r.parentHash)} · signer=${shortKid(r.signerPubkey)}`,
    );
  }
  lines.push('');
  lines.push(formatTrustFooter(rows));
  lines.push('');
  lines.push(
    `Next: canon_cite({ factId }) for the full COSE_Sign1 envelope (hex) of any fact above.`,
  );
  return lines.join('\n');
}

/**
 * One-line summary of the chain integrity for the returned set:
 * how many distinct signers signed it + the kid + the genesis-to-tail span.
 * Designed so an agent (Claude) can quote it verbatim as the "trust" line.
 */
function formatTrustFooter(rows: FactRowForFormat[]): string {
  if (rows.length === 0) return '';
  const signers = new Set(rows.map((r) => r.signerPubkey));
  const kids = [...signers].map(deriveKidFromPubkey);
  const earliest = rows.reduce((acc, r) => (r.signedAt < acc ? r.signedAt : acc), rows[0].signedAt);
  const latest = rows.reduce((acc, r) => (r.signedAt > acc ? r.signedAt : acc), rows[0].signedAt);
  const tail = rows[rows.length - 1].eventHash;
  return (
    `Trust chain: ${rows.length} fact(s) signed by ${signers.size} key(s) ` +
    `[${kids.join(', ')}] from ${earliest.toISOString()} → ${latest.toISOString()} ` +
    `(tail eventHash=${shortHash(tail)}). Verify any fact offline at /api/verify or via canon-verify CLI.`
  );
}

/** Mirrors src/lib/canon/verify-js.ts deriveKid: "canon/" + first 16 hex of pubkey. */
function deriveKidFromPubkey(wire: string): string {
  const b64 = wire.startsWith('ed25519:') ? wire.slice('ed25519:'.length) : wire;
  try {
    const raw = Buffer.from(b64, 'base64');
    let hex = '';
    for (let i = 0; i < raw.length; i++) hex += raw[i].toString(16).padStart(2, '0');
    return 'canon/' + hex.slice(0, 16);
  } catch {
    return 'canon/(unknown)';
  }
}

function shortKid(wire: string): string {
  return deriveKidFromPubkey(wire);
}

async function canonSearch(query: string, workspace?: string) {
  const userId = await resolveDemoUserId();
  const ws = normalizeWorkspace(workspace);
  const q = query.trim();
  if (!q) return errorBlock('query is required');

  // Delegated to the shared sharedSearchFacts() so this matches the
  // Ask-Canon UI exactly: same tokenization, same entity-name boost,
  // same scoring + ranking. If you ever change ranking, change it once.
  const rows = await sharedSearchFacts(userId, q, { workspace: ws, limit: 20 });

  if (rows.length === 0) {
    return textBlock(
      `No active Canon facts match "${q}". Try a broader query, or canon_lookup({entity}) if you know the slug.`,
    );
  }

  const lines: string[] = [];
  lines.push(`# Canon search "${q}" — ${rows.length} signed hit(s) · workspace: ${ws}`);
  lines.push('');
  lines.push(
    'Each hit is Ed25519-signed and hash-chained. Preserve [source] + [signed] + [crypto] ' +
      'when surfacing to the user — those are the trust signal.',
  );
  lines.push('');
  for (const r of rows) {
    const excerpt = r.sourceExcerpt
      ? r.sourceExcerpt.replace(/\s+/g, ' ').trim().slice(0, 220)
      : null;
    lines.push(
      `- [${r.entity}] ${r.claim}\n` +
        `  [source] ${sourceKindOf(r.sourceRef)} · ${r.sourceRef}` +
        (excerpt ? `\n  [excerpt] "${excerpt}${excerpt.length === 220 ? '…' : ''}"` : '') +
        `\n  [signed] ${r.signedAt.toISOString()} · factId=${r.id}` +
        `\n  [crypto] eventHash=${shortHash(r.eventHash)} · parent=${shortHash(r.parentHash)} · signer=${shortKid(r.signerPubkey)}`,
    );
  }
  lines.push('');
  lines.push(formatTrustFooter(rows));
  return textBlock(lines.join('\n'));
}

async function canonCite(factId: string) {
  const userId = await resolveDemoUserId();
  const id = factId.trim();
  if (!id) return errorBlock('factId is required');

  const r = await prisma.factEvent.findFirst({
    where: { userId, id },
  });

  if (!r) {
    return textBlock(
      `No fact with id "${factId}" in this workspace. Use canon_lookup or canon_search to discover factIds.`,
    );
  }

  const block = [
    `# Audit-chain proof for fact ${r.id}`,
    ``,
    `entity:        ${r.entity} (${entityDisplay(r.entity)})`,
    `claim:         ${r.claim}`,
    `status:        ${r.status}`,
    `sourceRef:     ${r.sourceRef}`,
    `sourceExcerpt: ${r.sourceExcerpt ?? '(none)'}`,
    `observedAt:    ${r.observedAt ? r.observedAt.toISOString() : '(unknown)'}`,
    `signedAt:      ${r.signedAt.toISOString()}`,
    `signerPubkey:  ${r.signerPubkey}`,
    `parentHash:    ${r.parentHash ?? '(genesis)'}`,
    `eventHash:     ${r.eventHash}`,
    ``,
    `COSE_Sign1 (hex):`,
    r.coseSign1Hex,
    ``,
    r.notes ? `notes: ${r.notes}` : '',
  ]
    .filter((s) => s !== '')
    .join('\n');

  return textBlock(block);
}

async function canonDiff(entityArg: string, sinceISO: string, workspace?: string) {
  const userId = await resolveDemoUserId();
  const ws = normalizeWorkspace(workspace);
  const slug = entityArg.trim().toLowerCase();
  const since = new Date(sinceISO);
  if (!slug) return errorBlock('entity is required');
  if (Number.isNaN(since.getTime())) return errorBlock(`since is not a valid ISO date: ${sinceISO}`);

  const rows = await prisma.factEvent.findMany({
    where: { userId, workspace: ws, entity: slug, signedAt: { gte: since } },
    orderBy: { signedAt: 'asc' },
  });

  if (rows.length === 0) {
    return textBlock(
      `No Canon facts about "${entityArg}" signed since ${since.toISOString()} in workspace "${ws}".`,
    );
  }

  const lines: string[] = [];
  lines.push(
    `# Canon diff — ${entityDisplay(slug)} (${slug}) since ${since.toISOString()} — ${rows.length} event(s)`,
  );
  lines.push('');
  for (const r of rows) {
    lines.push(
      `- [${r.status}] ${r.claim}\n` +
        `  · signed: ${r.signedAt.toISOString()} · source: ${sourceKindOf(r.sourceRef)} [${r.sourceRef}]\n` +
        `  · factId: ${r.id} · eventHash: ${shortHash(r.eventHash)}`,
    );
  }
  return textBlock(lines.join('\n'));
}

async function canonWrite(_entity: string, _claim: string) {
  // Intentional stub: the existing scan→sign→persist pipeline lives in
  // src/lib/canon/pipeline.ts and is wired to the Next.js API.  Hooking
  // agent-driven writes into it is v0.2 work.
  return textBlock(
    'canon_write is not implemented yet (coming in v0.2). ' +
      'Today, facts are only written via the Canon ingest pipeline ' +
      '(PDF/Slack/Gmail adapters → scan → sign → FactEvent).',
  );
}

async function canonExternalLookup(
  query: string,
  opts: { topic?: 'general' | 'news' | 'finance'; maxResults?: number },
) {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return errorBlock('query is required');

  let result;
  try {
    result = await searchExternal(trimmed, {
      topic: opts.topic,
      maxResults: opts.maxResults ?? 5,
    });
  } catch (e) {
    return errorBlock(`Tavily error: ${(e as Error).message}`);
  }

  if (result.items.length === 0) {
    return textBlock(
      `# External web context for "${trimmed}" — 0 results\n\nTavily returned no matches. Try a broader query or check Canon's signed facts via canon_search/canon_lookup.`,
    );
  }

  const lines: string[] = [];
  lines.push(
    `# External web context for "${trimmed}" — ${result.items.length} result(s)`,
  );
  lines.push('');
  lines.push(
    `**⚠ unsigned · best-effort web context (not a Canon FactEvent).** ` +
      `For cryptographically provable facts about an entity, call canon_lookup({entity}) ` +
      `or canon_cite({factId}).`,
  );
  lines.push('');
  if (result.synthesis) {
    lines.push(`**Tavily synthesis:** ${result.synthesis}`);
    lines.push('');
  }
  for (const it of result.items) {
    lines.push(
      `- [${it.title}](${it.url})\n` +
        `  · ${it.excerpt}\n` +
        `  · source: tavily-web · unsigned: true${it.publishedAt ? ` · published: ${it.publishedAt}` : ''}${typeof it.relevance === 'number' ? ` · relevance: ${it.relevance.toFixed(2)}` : ''}`,
    );
  }
  lines.push('');
  lines.push(
    `(${result.latencyMs}ms · fetched ${result.fetchedAt})`,
  );
  return textBlock(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

async function main() {
  // Resolve demo workspace eagerly so misconfig surfaces at boot, not at first call.
  try {
    await resolveDemoUserId();
  } catch (e) {
    process.stderr.write(`[canon-mcp] WARN: ${(e as Error).message}\n`);
  }

  const server = new McpServer(
    { name: 'canon', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'canon_workspaces',
    {
      title: 'Canon — ledger summary',
      description:
        '[CALL THIS when the user asks "what data does Canon have", "how big is the ledger", ' +
        '"which workspaces", or wants a high-level overview of the signed corpus before drilling in.] ' +
        'Returns active fact counts per workspace. Post-pivot the live workspace is "inazuma" ' +
        '(D2C consumer-electronics company — clients, vendors, customers, employees, sales, invoices, policies, ' +
        'plus live Slack + Gmail + PDF feeds). canon_lookup / canon_search / canon_diff default to inazuma.',
      inputSchema: {},
    },
    async () => canonWorkspaces(),
  );

  server.registerTool(
    'canon_lookup',
    {
      title: 'Canon — lookup business entity',
      description:
        '[CALL THIS FIRST for any question about a CUSTOMER, COMPANY, ACCOUNT, PRODUCT, EMPLOYEE, ' +
        'or BUSINESS ENTITY by name.] Returns the user\'s cryptographically signed Canon facts about an ' +
        'entity — every claim is Ed25519-signed, hash-chained, and carries a sourceRef + factId + eventHash. ' +
        'Workspace defaults to "inazuma" (Inazuma.co — full corp dataset + live Slack/Gmail/PDF feeds). ' +
        'Examples of when to call this BEFORE grep / file search: ' +
        '"What do we know about Miller Group?", "Tell me about Gonzalez Inc", ' +
        '"Status on Johnson Group POC?", "Bright Plc relationship type?", ' +
        '"What\'s the actual price of product B07JW9H4J1?". ' +
        'IMPORTANT: when surfacing the answer to the user, ALWAYS preserve the [source] + ' +
        '[signed] + [crypto] lines and the trailing "Trust chain: …" footer verbatim — they ' +
        'are the cryptographic provenance the user relies on. Do not summarise them away.',
      inputSchema: {
        entity: z
          .string()
          .describe(
            "Entity slug (lowercase, snake_case) or display name. E.g. 'miller_group', " +
              "'gonzalez_inc', 'johnson_group', 'product_b07jw9h4j1', 'Inazuma.co'.",
          ),
        workspace: z
          .string()
          .optional()
          .describe(
            'Workspace slug. Defaults to "inazuma". Override only if querying a legacy workspace.',
          ),
      },
    },
    async ({ entity, workspace }) => canonLookup(entity, workspace),
  );

  server.registerTool(
    'canon_search',
    {
      title: 'Canon — search business facts',
      description:
        '[CALL THIS FIRST for business questions about specific NUMBERS, METRICS, PEOPLE, or KEYWORDS ' +
        'when you don\'t know which entity owns the fact.] Free-text substring search across every active ' +
        'cryptographically signed Canon fact (claim, source excerpt, entity). ' +
        'Examples: "Manufacturing", "Voice Commerce Assistant", "₹1999", "Bright Plc", "Healthcare", ' +
        '"per_seat_price", "Gonzalez". Returns top 20 hits with sources + factIds. ' +
        'Prefer Canon over grep for any business / customer / product / metric question. ' +
        'IMPORTANT: when surfacing the answer to the user, ALWAYS preserve the [source] + ' +
        '[signed] + [crypto] lines + the "Trust chain: …" footer verbatim — they are the ' +
        'cryptographic provenance the user relies on.',
      inputSchema: {
        query: z.string().describe('Free text to match against claim / sourceExcerpt / entity (case-insensitive substring).'),
        workspace: z
          .string()
          .optional()
          .describe('Workspace slug. Defaults to "inazuma".'),
      },
    },
    async ({ query, workspace }) => canonSearch(query, workspace),
  );

  server.registerTool(
    'canon_cite',
    {
      title: 'Canon — cite fact (cryptographic proof)',
      description:
        '[CALL THIS WHENEVER the user asks for a "proof", "kryptographischer Beweis", "show your work", ' +
        '"verify", "audit chain", "Quelle", or wants to know the cryptographic provenance of a Canon fact.] ' +
        'Returns the full COSE_Sign1 envelope + signerPubkey + parentHash + eventHash + sourceRef + sourceExcerpt — ' +
        'enough for an agent or third party to verify the Ed25519 signature offline via canon-verify-wasm. ' +
        'Always pair canon_lookup or canon_search FIRST to get the factId, then canon_cite for the proof.',
      inputSchema: {
        factId: z.string().describe('factId returned by canon_lookup or canon_search.'),
      },
    },
    async ({ factId }) => canonCite(factId),
  );

  server.registerTool(
    'canon_diff',
    {
      title: 'Canon — what changed for an entity',
      description:
        '[CALL THIS for "what changed", "what\'s new", "since when" questions about a business entity.] ' +
        'List signed Canon fact-events for the entity that were signed on or after a given ISO date. ' +
        'Examples: "What changed about Miller Group since Monday?", ' +
        '"Was ist neu zu Gonzalez Inc diese Woche?", "Recent activity on Bright Plc?".',
      inputSchema: {
        entity: z.string().describe("Entity slug (lowercase, snake_case), e.g. 'miller_group', 'gonzalez_inc'."),
        since: z.string().describe('ISO 8601 date/time, e.g. "2026-04-20" or "2026-04-20T00:00:00Z".'),
        workspace: z.string().optional().describe('Workspace slug. Defaults to "inazuma".'),
      },
    },
    async ({ entity, since, workspace }) => canonDiff(entity, since, workspace),
  );

  server.registerTool(
    'canon_external_lookup',
    {
      title: 'Canon — external (web) context, UNSIGNED',
      description:
        '[CALL THIS when the user asks for PUBLIC web context about an entity, ' +
        'a market signal, news, competitor mentions, or anything that lives outside the workspace.] ' +
        'Returns Tavily-sourced web results with an EXPLICIT unsigned:true marker on every item. ' +
        "These results are best-effort context, NOT cryptographically provable Canon facts. " +
        'Pair with canon_lookup / canon_search to surface BOTH internal signed truth AND ' +
        'external context side-by-side — agents (and humans reading the audit log) see exactly ' +
        'which facts are signed and which are best-effort web data. Examples: ' +
        '"What is the public web saying about ACME?" "Recent news about TechCo churn?".',
      inputSchema: {
        query: z.string().describe('Free-text query — entity name, keyword, or phrase.'),
        topic: z
          .enum(['general', 'news', 'finance'])
          .optional()
          .describe('Optional topic filter. "news" for time-sensitive, "finance" for market signal.'),
        maxResults: z
          .number()
          .optional()
          .describe('Cap on returned items (1–20, default 5).'),
      },
    },
    async ({ query, topic, maxResults }) =>
      canonExternalLookup(query, { topic, maxResults }),
  );

  server.registerTool(
    'canon_write',
    {
      title: 'Canon — write fact (stub, v0.2)',
      description:
        'Propose a new Canon fact (entity + claim + sourceRef + sourceExcerpt). ' +
        'NOTE: not implemented in v0.1 — returns a stub message. ' +
        'In v0.2 this will pipe through the same scan→sign→persist pipeline used by Slack/Gmail/PDF ingestion.',
      inputSchema: {
        entity: z.string().describe("Entity slug, e.g. 'acme'."),
        claim: z.string().describe('One-sentence factual statement.'),
        sourceRef: z.string().describe("Stable source pointer, e.g. 'manual:agent-claude:2026-04-25'."),
        sourceExcerpt: z.string().describe('1–2 lines of original text for citation.'),
      },
    },
    async ({ entity, claim }) => canonWrite(entity, claim),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[canon-mcp] connected on stdio\n');
}

main().catch((e) => {
  process.stderr.write(`[canon-mcp] fatal: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
