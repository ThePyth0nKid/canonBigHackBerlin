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
 * Demo workspace = the most-recently-created User (matches the Northwind seed).
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
import { PrismaClient } from '../src/generated/prisma/client.js';
import { searchExternal } from '../src/lib/canon/tavily.js';

// ---------------------------------------------------------------------------
// Prisma client (we instantiate locally instead of importing the Next-aware
// singleton from src/lib/prisma.ts because this script runs outside Next).
// ---------------------------------------------------------------------------
const prisma = new PrismaClient({ log: ['error'] });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_DISPLAY: Record<string, string> = {
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

async function canonLookup(entityArg: string) {
  const userId = await resolveDemoUserId();
  const slug = entityArg.trim().toLowerCase();
  if (!slug) return errorBlock('entity is required');

  const rows = await prisma.factEvent.findMany({
    where: { userId, entity: slug, status: 'active' },
    orderBy: { signedAt: 'asc' },
  });

  if (rows.length === 0) {
    // Fallback: case-insensitive contains, in case the agent passed display name.
    const fuzzy = await prisma.factEvent.findMany({
      where: {
        userId,
        status: 'active',
        entity: { contains: slug, mode: 'insensitive' },
      },
      orderBy: { signedAt: 'asc' },
      take: 50,
    });
    if (fuzzy.length === 0) {
      return textBlock(
        `No facts found for entity "${entityArg}". Known entities for this workspace: ` +
          (await listKnownEntities(userId)).join(', '),
      );
    }
    return textBlock(formatLookup(slug, fuzzy));
  }

  return textBlock(formatLookup(slug, rows));
}

async function listKnownEntities(userId: string): Promise<string[]> {
  const distinct = await prisma.factEvent.findMany({
    where: { userId, status: 'active' },
    select: { entity: true },
    distinct: ['entity'],
  });
  return distinct.map((d) => d.entity);
}

function formatLookup(slug: string, rows: Array<{
  id: string;
  entity: string;
  claim: string;
  sourceRef: string;
  signedAt: Date;
  eventHash: string;
}>): string {
  const display = entityDisplay(slug);
  const lines: string[] = [];
  lines.push(`# Canon facts about ${display} (${slug}) — ${rows.length} active fact(s)`);
  lines.push('');
  for (const r of rows) {
    const kind = sourceKindOf(r.sourceRef);
    lines.push(
      `- ${r.claim}\n` +
        `  · source: ${kind} [${r.sourceRef}]\n` +
        `  · signed: ${r.signedAt.toISOString()}\n` +
        `  · factId: ${r.id}\n` +
        `  · eventHash: ${shortHash(r.eventHash)}`,
    );
  }
  lines.push('');
  lines.push(
    `Tip: call canon_cite({ factId }) to get the full COSE_Sign1 audit-chain proof for any fact above.`,
  );
  return lines.join('\n');
}

async function canonSearch(query: string) {
  const userId = await resolveDemoUserId();
  const q = query.trim();
  if (!q) return errorBlock('query is required');

  const rows = await prisma.factEvent.findMany({
    where: {
      userId,
      status: 'active',
      OR: [
        { claim: { contains: q, mode: 'insensitive' } },
        { sourceExcerpt: { contains: q, mode: 'insensitive' } },
        { entity: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { signedAt: 'desc' },
    take: 20,
  });

  if (rows.length === 0) {
    return textBlock(`No active Canon facts match "${q}".`);
  }

  const lines: string[] = [];
  lines.push(`# Canon search "${q}" — ${rows.length} hit(s)`);
  lines.push('');
  for (const r of rows) {
    lines.push(
      `- [${r.entity}] ${r.claim}\n` +
        `  · source: ${sourceKindOf(r.sourceRef)} [${r.sourceRef}]\n` +
        `  · signed: ${r.signedAt.toISOString()}\n` +
        `  · factId: ${r.id} · eventHash: ${shortHash(r.eventHash)}`,
    );
  }
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

async function canonDiff(entityArg: string, sinceISO: string) {
  const userId = await resolveDemoUserId();
  const slug = entityArg.trim().toLowerCase();
  const since = new Date(sinceISO);
  if (!slug) return errorBlock('entity is required');
  if (Number.isNaN(since.getTime())) return errorBlock(`since is not a valid ISO date: ${sinceISO}`);

  const rows = await prisma.factEvent.findMany({
    where: { userId, entity: slug, signedAt: { gte: since } },
    orderBy: { signedAt: 'asc' },
  });

  if (rows.length === 0) {
    return textBlock(
      `No Canon facts about "${entityArg}" signed since ${since.toISOString()}.`,
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
    'canon_lookup',
    {
      title: 'Canon — lookup business entity',
      description:
        '[CALL THIS FIRST for any question about a CUSTOMER, COMPANY, ACCOUNT, DEAL, or BUSINESS ENTITY by name.] ' +
        'Returns the user\'s cryptographically signed Canon facts about an entity — every claim is Ed25519-signed, ' +
        'hash-chained, and carries a sourceRef + factId + eventHash. ' +
        'Examples of when to call this BEFORE grep / file search: ' +
        '"What do we know about ACME?", "Tell me about Northwind", "What\'s the status on TechCo?", ' +
        '"What is X\'s renewal date / MRR / ACV / seat count?", "Customer X facts with proof". ' +
        'Canon is the workspace\'s signed source-of-truth for business facts; only fall back to file search if Canon returns no facts.',
      inputSchema: {
        entity: z
          .string()
          .describe(
            "Entity slug (lowercase) or display name. E.g. 'northwind', 'acme', 'techco', 'ACME GmbH'.",
          ),
      },
    },
    async ({ entity }) => canonLookup(entity),
  );

  server.registerTool(
    'canon_search',
    {
      title: 'Canon — search business facts',
      description:
        '[CALL THIS FIRST for business questions about specific NUMBERS, METRICS, PEOPLE, or KEYWORDS] ' +
        'when you don\'t know which entity owns the fact. Free-text substring search across every active ' +
        'cryptographically signed Canon fact in the workspace (claim, source excerpt, entity). ' +
        'Examples: "Q1 MRR", "renewal 2026-05-15", "€127,000", "Petra Voss", "churn", "billing integration". ' +
        'Returns top 20 hits with sources + factIds. Prefer Canon over grep for any business / customer / metric question.',
      inputSchema: {
        query: z.string().describe('Free text to match against claim / sourceExcerpt / entity (case-insensitive substring).'),
      },
    },
    async ({ query }) => canonSearch(query),
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
        'Examples: "What changed about Northwind since Monday?", "Was ist neu zu ACME diese Woche?".',
      inputSchema: {
        entity: z.string().describe("Entity slug (lowercase), e.g. 'northwind'."),
        since: z.string().describe('ISO 8601 date/time, e.g. "2026-04-20" or "2026-04-20T00:00:00Z".'),
      },
    },
    async ({ entity, since }) => canonDiff(entity, since),
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
