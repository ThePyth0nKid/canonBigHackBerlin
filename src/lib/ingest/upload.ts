/**
 * File-upload ingest router.
 *
 * Takes any file the user drops into /app and turns it into the same
 * `{ directDrafts, pipelineChunks }` shape that the bundled Qontext
 * loader produces, so the existing Pioneer + signer pipeline stays
 * untouched.
 *
 *   • JSON (array or object) → records → typed mapper if shape matches
 *     a known Qontext record (clients/vendors/customers/employees/
 *     emails/conversations/posts/IT-tickets), otherwise generic JSON-
 *     record-to-chunk fallback.
 *   • NDJSON → same routing per line.
 *   • CSV → header-driven object array → same routing.
 *   • TXT/MD → paragraph chunks (split on blank line).
 *   • PDF → page chunks via pdf-parse v2.
 *
 * Generic fallback: stringify the record (truncated), feed it to
 * Pioneer as a Chunk with a heuristic defaultEntity from common name
 * fields. Pioneer extracts entity + metric per the same schema it
 * uses for all other sources.
 *
 * Provenance: every draft + chunk gets a sourceRef like
 *   "upload:<filename-slug>:<record-id-or-index>"
 * so the audit chain can trace any signed fact back to a specific row
 * inside the user-uploaded file.
 */

import type { FactDraft } from '@/lib/canon/types';
import type { Chunk } from '@/lib/canon/pioneer';
import {
  type ClientRecord,
  type VendorRecord,
  type CustomerRecord,
  type EmployeeRecord,
  type EmailRecord,
  type ConversationRecord,
  type PostRecord,
  type ItTicketRecord,
  clientToDrafts,
  vendorToDrafts,
  customerToDrafts,
  employeeToDrafts,
  emailToChunks,
  conversationToChunks,
  postToDrafts,
  itTicketToDrafts,
  slugify,
  clientSlug,
} from '@/lib/ingest/qontext';

export type UploadFiletype =
  | 'json'
  | 'ndjson'
  | 'csv'
  | 'text'
  | 'pdf'
  | 'unknown';

export interface UploadParseResult {
  filename: string;
  filenameSlug: string;
  filetype: UploadFiletype;
  /** How many top-level records / pages / paragraphs we found. */
  recordCount: number;
  /** Per-record routing decision (typed mapper used, or generic fallback). */
  shape:
    | 'qontext-clients'
    | 'qontext-vendors'
    | 'qontext-customers'
    | 'qontext-employees'
    | 'qontext-emails'
    | 'qontext-conversations'
    | 'qontext-posts'
    | 'qontext-it-tickets'
    | 'generic-json'
    | 'csv-rows'
    | 'paragraphs'
    | 'pdf-pages'
    | 'single-object'
    | 'unknown';
  directDrafts: FactDraft[];
  pipelineChunks: Chunk[];
}

/** Hard caps so a runaway upload doesn't burn the entire Pioneer budget. */
const MAX_RECORDS = 5000;
const MAX_TEXT_BYTES = 50 * 1024 * 1024; // 50 MB

export async function parseUploadedFile(file: File): Promise<UploadParseResult> {
  const filename = file.name;
  const filenameSlug = slugify(filename.replace(/\.[^.]+$/, '')).slice(0, 32);
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const observedAt = new Date().toISOString();

  if (file.size > MAX_TEXT_BYTES && ext !== 'pdf') {
    throw new Error(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Cap is ${
        MAX_TEXT_BYTES / 1024 / 1024
      } MB for text uploads.`,
    );
  }

  // ----- PDF: page-per-chunk -----
  if (ext === 'pdf') {
    const buf = new Uint8Array(await file.arrayBuffer());
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    const pages = (result.pages ?? []) as Array<{
      text?: string;
      pageNumber?: number;
    }>;
    const chunks = pages
      .map((p, idx): Chunk | null => {
        const pageNum = p.pageNumber ?? idx + 1;
        const text = (p.text ?? '').replace(/\s+/g, ' ').trim();
        if (text.length < 40) return null;
        return {
          text: text.slice(0, 1200),
          sourceRef: `upload:${filenameSlug}:p${pageNum}`,
          observedAt,
          sourceExcerpt: text.slice(0, 240),
        };
      })
      .filter((c): c is Chunk => c !== null);
    return {
      filename,
      filenameSlug,
      filetype: 'pdf',
      recordCount: chunks.length,
      shape: 'pdf-pages',
      directDrafts: [],
      pipelineChunks: chunks,
    };
  }

  const text = await file.text();

  // ----- JSON / NDJSON -----
  if (ext === 'json' || ext === 'ndjson' || isLikelyJson(text)) {
    const records = ext === 'ndjson' ? parseNdjson(text) : parseJsonArrayOrObject(text);
    const limited = records.slice(0, MAX_RECORDS);
    return routeRecords(limited, {
      filename,
      filenameSlug,
      filetype: ext === 'ndjson' ? 'ndjson' : 'json',
      observedAt,
    });
  }

  // ----- CSV -----
  if (ext === 'csv') {
    const records = parseCsv(text).slice(0, MAX_RECORDS);
    return routeRecords(records, {
      filename,
      filenameSlug,
      filetype: 'csv',
      observedAt,
    });
  }

  // ----- TXT / MD / fallback -----
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 40)
    .slice(0, MAX_RECORDS);
  const chunks: Chunk[] = paragraphs.map((p, idx) => ({
    text: p.slice(0, 1200),
    sourceRef: `upload:${filenameSlug}:para-${idx + 1}`,
    observedAt,
    sourceExcerpt: p.slice(0, 240),
  }));
  return {
    filename,
    filenameSlug,
    filetype: 'text',
    recordCount: chunks.length,
    shape: 'paragraphs',
    directDrafts: [],
    pipelineChunks: chunks,
  };
}

/* ------------------------------------------------------------------ *
 *  Record routing
 * ------------------------------------------------------------------ */

interface RouteCtx {
  filename: string;
  filenameSlug: string;
  filetype: UploadFiletype;
  observedAt: string;
}

function routeRecords(
  records: Record<string, unknown>[],
  ctx: RouteCtx,
): UploadParseResult {
  if (records.length === 0) {
    return {
      filename: ctx.filename,
      filenameSlug: ctx.filenameSlug,
      filetype: ctx.filetype,
      recordCount: 0,
      shape: 'unknown',
      directDrafts: [],
      pipelineChunks: [],
    };
  }

  // Single-object JSON file (no array, no NDJSON) — treat it as one record.
  if (records.length === 1 && !looksLikeArrayElement(records[0])) {
    const r = records[0];
    const text = jsonRecordToText(r);
    if (!text) {
      return {
        filename: ctx.filename,
        filenameSlug: ctx.filenameSlug,
        filetype: ctx.filetype,
        recordCount: 1,
        shape: 'single-object',
        directDrafts: [],
        pipelineChunks: [],
      };
    }
    return {
      filename: ctx.filename,
      filenameSlug: ctx.filenameSlug,
      filetype: ctx.filetype,
      recordCount: 1,
      shape: 'single-object',
      directDrafts: [],
      pipelineChunks: [
        {
          text: text.slice(0, 1200),
          sourceRef: `upload:${ctx.filenameSlug}:doc`,
          observedAt: ctx.observedAt,
          sourceExcerpt: text.slice(0, 240),
          defaultEntity: heuristicEntity(r) ?? ctx.filenameSlug,
        },
      ],
    };
  }

  const sample = records[0];
  const shape = detectShape(sample);

  switch (shape) {
    case 'qontext-clients': {
      const drafts = (records as unknown as ClientRecord[]).flatMap(clientToDrafts);
      return mkResult(ctx, records.length, shape, drafts, []);
    }
    case 'qontext-vendors': {
      const drafts = (records as unknown as VendorRecord[]).flatMap(vendorToDrafts);
      return mkResult(ctx, records.length, shape, drafts, []);
    }
    case 'qontext-customers': {
      const drafts = (records as unknown as CustomerRecord[]).flatMap(customerToDrafts);
      return mkResult(ctx, records.length, shape, drafts, []);
    }
    case 'qontext-employees': {
      const drafts = (records as unknown as EmployeeRecord[]).flatMap(employeeToDrafts);
      return mkResult(ctx, records.length, shape, drafts, []);
    }
    case 'qontext-posts': {
      const drafts = (records as unknown as PostRecord[]).flatMap(postToDrafts);
      return mkResult(ctx, records.length, shape, drafts, []);
    }
    case 'qontext-it-tickets': {
      const drafts = (records as unknown as ItTicketRecord[]).flatMap(itTicketToDrafts);
      return mkResult(ctx, records.length, shape, drafts, []);
    }
    case 'qontext-emails': {
      const chunks = (records as unknown as EmailRecord[]).flatMap(emailToChunks);
      return mkResult(ctx, records.length, shape, [], chunks);
    }
    case 'qontext-conversations': {
      const chunks = (records as unknown as ConversationRecord[]).flatMap(
        conversationToChunks,
      );
      return mkResult(ctx, records.length, shape, [], chunks);
    }
    default: {
      // Generic JSON / CSV record → free-form chunk for Pioneer.
      const chunks = records
        .map((r, idx): Chunk | null => {
          const text = jsonRecordToText(r);
          if (!text || text.length < 12) return null;
          const id = (r.id ?? r.client_id ?? r.email_id ?? r.record_id ?? `row-${idx + 1}`) as
            | string
            | number;
          return {
            text: text.slice(0, 1200),
            sourceRef: `upload:${ctx.filenameSlug}:${id}`,
            observedAt: ctx.observedAt,
            sourceExcerpt: text.slice(0, 240),
            defaultEntity: heuristicEntity(r) ?? ctx.filenameSlug,
          };
        })
        .filter((c): c is Chunk => c !== null);
      return mkResult(
        ctx,
        records.length,
        ctx.filetype === 'csv' ? 'csv-rows' : 'generic-json',
        [],
        chunks,
      );
    }
  }
}

function mkResult(
  ctx: RouteCtx,
  recordCount: number,
  shape: UploadParseResult['shape'],
  directDrafts: FactDraft[],
  pipelineChunks: Chunk[],
): UploadParseResult {
  return {
    filename: ctx.filename,
    filenameSlug: ctx.filenameSlug,
    filetype: ctx.filetype,
    recordCount,
    shape,
    directDrafts,
    pipelineChunks,
  };
}

/* ------------------------------------------------------------------ *
 *  Shape detection — match the typed Qontext mappers when we can.
 * ------------------------------------------------------------------ */

function detectShape(r: Record<string, unknown>): UploadParseResult['shape'] {
  const keys = new Set(Object.keys(r));
  if (keys.has('client_id') && keys.has('business_name')) {
    if (
      keys.has('monthly_revenue') ||
      keys.has('current_POC_product') ||
      keys.has('contact_person_name')
    ) {
      return 'qontext-clients';
    }
    return 'qontext-vendors';
  }
  if (keys.has('customer_id') && keys.has('customer_name')) return 'qontext-customers';
  if (keys.has('email_id') && keys.has('subject') && keys.has('body')) return 'qontext-emails';
  if (keys.has('conversation_id') && keys.has('text')) return 'qontext-conversations';
  if (keys.has('Title') && keys.has('Post')) return 'qontext-posts';
  if (keys.has('Issue') || (keys.has('Resolution') && keys.has('emp_id'))) {
    return 'qontext-it-tickets';
  }
  if (keys.has('category') && keys.has('description') && (keys.has('index') || keys.has('emp_id'))) {
    return 'qontext-employees';
  }
  return 'generic-json';
}

/* ------------------------------------------------------------------ *
 *  Parsers
 * ------------------------------------------------------------------ */

function isLikelyJson(t: string): boolean {
  const head = t.trimStart().charAt(0);
  return head === '[' || head === '{';
}

function parseJsonArrayOrObject(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (Array.isArray(parsed)) return parsed.filter(isObj);
  if (isObj(parsed)) {
    // {"items": [...]} / {"data": [...]} convenience unwrap
    for (const k of ['items', 'data', 'records', 'results']) {
      if (k in parsed && Array.isArray((parsed as Record<string, unknown>)[k])) {
        return ((parsed as Record<string, unknown>)[k] as unknown[]).filter(isObj) as Record<
          string,
          unknown
        >[];
      }
    }
    return [parsed];
  }
  return [];
}

function parseNdjson(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const v = JSON.parse(trimmed);
      if (isObj(v)) out.push(v);
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/**
 * Minimal RFC4180-tolerant CSV parser. Supports double-quoted fields with
 * embedded commas and escaped `""`. Handles \r\n line endings. No external
 * dependency — the demo-day footprint stays tiny.
 */
function parseCsv(text: string): Record<string, unknown>[] {
  const rows = csvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const k = h.trim();
      if (!k) return;
      obj[k] = r[i] ?? '';
    });
    return obj;
  });
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      inQuote = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      row.push(cell);
      cell = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 *  Generic JSON-record-to-text + entity heuristic
 * ------------------------------------------------------------------ */

function jsonRecordToText(r: Record<string, unknown>): string {
  // Render "key: value, key: value" — keeps Pioneer's job tractable and
  // produces a useful sourceExcerpt. Skip huge / nested fields.
  const parts: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (v == null) continue;
    if (typeof v === 'object') continue; // skip nested
    const s = String(v).replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (s.length > 200) continue;
    parts.push(`${k}: ${s}`);
    if (parts.length >= 12) break;
  }
  return parts.join(', ');
}

const ENTITY_KEYS = [
  'business_name',
  'company_name',
  'customer_name',
  'account_name',
  'name',
  'company',
  'organization',
  'org',
  'vendor_name',
  'client_name',
];

function heuristicEntity(r: Record<string, unknown>): string | undefined {
  for (const k of ENTITY_KEYS) {
    const v = r[k];
    if (typeof v === 'string' && v.trim().length > 0) {
      return clientSlug(v);
    }
  }
  return undefined;
}

function looksLikeArrayElement(r: Record<string, unknown>): boolean {
  // Heuristic: an object with an "id"-shaped key and few short fields
  // looks like a record that *would* appear inside an array of similar
  // records. A document-shaped object (huge body / many top-level keys)
  // does not.
  const keys = Object.keys(r);
  if (keys.length > 25) return false;
  return keys.some((k) => /(^|_)(id|key|slug)$/i.test(k));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
