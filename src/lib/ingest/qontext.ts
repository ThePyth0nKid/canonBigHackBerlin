/**
 * Qontext-supplied enterprise dataset adapter.
 *
 * The Qontext Big Berlin Hack 2026 brief provides a simulated enterprise
 * dataset for the company `Inazuma.co` (D2C, ~1260 employees, 400 B2B
 * clients, 90 D2C customers). It ships as JSON files under
 * `demo/qontext/Dataset/<system>/...`.
 *
 * This adapter demonstrates that Canon's FactDraft contract is dataset-
 * agnostic: the SAME pipeline (scan → audit → sign → persist) that
 * canonizes Northwind facts also canonizes Inazuma facts. Sample-sized
 * by default so the demo /app stays readable; turn up `limits` to ingest
 * the whole thing.
 *
 * Two ingest strategies coexist here:
 *   1. Direct structured ingest — clients/customers/employees are
 *      already perfectly-typed records, so we emit FactDrafts
 *      DETERMINISTICALLY without running them through Pioneer.
 *      Hash-stable by construction.
 *   2. Pipeline-via-Pioneer — emails and conversations are free-form
 *      text; we feed them through the existing Pioneer span extractor
 *      via the standard chunking flow.
 *
 * Both produce facts with the SAME shape, so /app and the MCP server
 * can't tell the difference between Inazuma and Northwind facts in the
 * ledger.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FactDraft } from '../canon/types';
import type { Chunk } from '../canon/pioneer';

const DATA_ROOT = path.resolve(process.cwd(), 'demo/qontext/Dataset');

const COMPANY_SLUG = 'inazuma';
const COMPANY_DISPLAY = 'Inazuma.co';

export interface QontextLimits {
  maxClients?: number;
  maxVendors?: number;
  maxCustomers?: number;
  maxEmployees?: number;
  maxEmails?: number;
  maxConversations?: number;
  maxPosts?: number;
  maxItTickets?: number;
  maxPolicies?: number;
}

/** Default sample sizes — tuned to land ~1500-2000 facts in the Inazuma workspace. */
const DEFAULT_LIMITS: Required<QontextLimits> = {
  maxClients: 400,
  maxVendors: 400,
  maxCustomers: 90,
  maxEmployees: 60,
  maxEmails: 60,
  maxConversations: 30,
  maxPosts: 30,
  maxItTickets: 40,
  maxPolicies: 8,
};

/**
 * Names where the Qontext dataset *itself* contains a duplicate or
 * cross-system ambiguity. Forced into the sample to make sure the demo
 * surfaces a real conflict from the customer's data — not one we
 * fabricated.
 */
const FORCED_CLIENT_BUSINESS_NAMES = [
  'Miller Group',     // appears 2x in clients.json with industry=Entertainment AND Manufacturing
  'Gonzalez Inc',     // appears 2x with industry=Manufacturing AND Entertainment
  'Johnson Group',    // appears 2x with industry=Transportation AND Logistics
];

/**
 * Names that appear in BOTH clients.json and vendors.json — natural
 * cross-source corroboration material (same company, two roles).
 */
const FORCED_DUAL_ROLE_NAMES = [
  'Huang LLC',
  'Williams Group',
  'Martin Ltd',
];

export interface QontextIngestResult {
  /** Direct structured FactDrafts that skip Pioneer. */
  directDrafts: FactDraft[];
  /** Chunks that should be fed through extractFactsFromChunks(). */
  pipelineChunks: Chunk[];
  counts: {
    clients: number;
    vendors: number;
    customers: number;
    employees: number;
    emails: number;
    conversations: number;
    posts: number;
    itTickets: number;
    policies: number;
  };
}

/* -------------------------------------------------------------------------- *
 * Public entry point
 * -------------------------------------------------------------------------- */

export async function loadQontextSample(
  limits: QontextLimits = {},
): Promise<QontextIngestResult> {
  const lim: Required<QontextLimits> = { ...DEFAULT_LIMITS, ...limits };

  const directDrafts: FactDraft[] = [];
  const pipelineChunks: Chunk[] = [];
  const counts = {
    clients: 0,
    vendors: 0,
    customers: 0,
    employees: 0,
    emails: 0,
    conversations: 0,
    posts: 0,
    itTickets: 0,
    policies: 0,
  };

  // 1. Clients — B2B engagements (richest entity records).
  // Strategy: ALWAYS include the records whose business_name appears more
  // than once OR appears in both clients + vendors — those are the
  // dataset's own conflict / cross-source signals and the demo's gold.
  // Then fill the remainder with deterministic spaced sampling.
  let allClientsCached: ClientRecord[] = [];
  try {
    const clients = await readJson<ClientRecord[]>(
      'Business_and_Management/clients.json',
    );
    allClientsCached = clients;
    const forced = clients.filter((c) =>
      [...FORCED_CLIENT_BUSINESS_NAMES, ...FORCED_DUAL_ROLE_NAMES].some(
        (n) => (c.business_name ?? '').toLowerCase() === n.toLowerCase(),
      ),
    );
    const remainingBudget = Math.max(0, lim.maxClients - forced.length);
    const others = clients.filter((c) => !forced.includes(c));
    const filler = pickSample(others, remainingBudget);
    const sampled = [...forced, ...filler];
    for (const c of sampled) {
      directDrafts.push(...clientToDrafts(c));
    }
    counts.clients = sampled.length;
  } catch (e) {
    console.warn('[qontext] clients.json skipped:', (e as Error).message);
  }

  // 1b. Vendors — pick the dual-role names so the same business shows up
  // in two roles, plus a sampled remainder. Each vendor record provides
  // 2-3 facts (industry, business_type, relationship_description).
  try {
    const vendors = await readJson<VendorRecord[]>(
      'Business_and_Management/vendors.json',
    );
    const dualRoleVendors = vendors.filter((v) =>
      FORCED_DUAL_ROLE_NAMES.some(
        (n) => (v.business_name ?? '').toLowerCase() === n.toLowerCase(),
      ),
    );
    const sampled = [
      ...dualRoleVendors,
      ...pickSample(
        vendors.filter((v) => !dualRoleVendors.includes(v)),
        Math.max(0, lim.maxVendors - dualRoleVendors.length),
      ),
    ].slice(0, lim.maxVendors);
    for (const v of sampled) {
      directDrafts.push(...vendorToDrafts(v));
    }
    counts.vendors = sampled.length;
  } catch (e) {
    console.warn('[qontext] vendors.json skipped:', (e as Error).message);
  }

  // 2. Customers — D2C retail (lighter records).
  try {
    const customers = await readJson<CustomerRecord[]>(
      'Customer_Relation_Management/customers.json',
    );
    const sampled = pickSample(customers, lim.maxCustomers);
    for (const c of sampled) {
      directDrafts.push(...customerToDrafts(c));
    }
    counts.customers = sampled.length;
  } catch (e) {
    console.warn('[qontext] customers.json skipped:', (e as Error).message);
  }

  // 3. Employees — pick interesting samples (Engineering Directors, VPs).
  try {
    const employees = await readJson<EmployeeRecord[]>(
      'Human_Resource_Management/Employees/employees.json',
    );
    const directors = employees
      .filter((e) => /director|vp|chief|head/i.test(e.description ?? ''))
      .slice(0, lim.maxEmployees);
    for (const e of directors) {
      directDrafts.push(...employeeToDrafts(e));
    }
    counts.employees = directors.length;
  } catch (e) {
    console.warn('[qontext] employees.json skipped:', (e as Error).message);
  }

  // 4. Emails — feed through Pioneer like Gmail. Pick high-importance ones.
  try {
    const emails = await readJson<EmailRecord[]>(
      'Enterprise_Mail_System/emails.json',
    );
    const interesting = emails
      .filter((e) => (e.importance ?? '').toLowerCase() === 'high')
      .slice(0, lim.maxEmails);
    for (const e of interesting) {
      pipelineChunks.push(...emailToChunks(e));
    }
    counts.emails = interesting.length;
  } catch (e) {
    console.warn('[qontext] emails.json skipped:', (e as Error).message);
  }

  // 5. Conversations — feed through Pioneer like Slack.
  try {
    const conversations = await readJson<ConversationRecord[]>(
      'Collaboration_tools/conversations.json',
    );
    const recent = conversations
      .filter((c) => (c.text ?? '').length > 200)
      .slice(0, lim.maxConversations);
    for (const c of recent) {
      pipelineChunks.push(...conversationToChunks(c));
    }
    counts.conversations = recent.length;
  } catch (e) {
    console.warn('[qontext] conversations.json skipped:', (e as Error).message);
  }

  // 6. Social posts — direct ingest (each post → 1 fact about a topic).
  try {
    const posts = await readJson<PostRecord[]>(
      'Enterprise_Social_Platform/posts.json',
    );
    const sampled = pickSample(posts, lim.maxPosts);
    for (const p of sampled) {
      directDrafts.push(...postToDrafts(p));
    }
    counts.posts = sampled.length;
  } catch (e) {
    console.warn('[qontext] posts.json skipped:', (e as Error).message);
  }

  // 7. IT Service Management tickets — direct ingest (status+priority+assignee).
  try {
    const tickets = await readJson<ItTicketRecord[]>(
      'IT_Service_Management/it_tickets.json',
    );
    const sampled = pickSample(tickets, lim.maxItTickets);
    for (const t of sampled) {
      directDrafts.push(...itTicketToDrafts(t));
    }
    counts.itTickets = sampled.length;
  } catch (e) {
    console.warn('[qontext] it_tickets.json skipped:', (e as Error).message);
  }

  // 8. Policy PDFs — feed each policy through Pioneer like the Q1 board deck.
  try {
    const policyChunks = await loadPolicyPdfChunks(lim.maxPolicies);
    pipelineChunks.push(...policyChunks);
    counts.policies = new Set(policyChunks.map((c) => c.sourceRef.split('#')[0])).size;
  } catch (e) {
    console.warn('[qontext] policies skipped:', (e as Error).message);
  }

  return { directDrafts, pipelineChunks, counts };
}

/* -------------------------------------------------------------------------- *
 * Record types
 * -------------------------------------------------------------------------- */

interface ClientRecord {
  client_id: string;
  business_name: string;
  industry?: string;
  business_type?: string;
  contact_person_name?: string;
  contact_email?: string;
  registered_address?: string;
  monthly_revenue?: string;
  onboarding_date?: string;
  current_POC_product?: string;
  POC_status?: string;
  engagement_value?: string;
}

interface VendorRecord {
  client_id: string;
  business_name: string;
  industry?: string;
  business_type?: string;
  registered_address?: string;
  tax_id?: string;
  onboarding_date?: string;
  relationship_description?: string;
  management_representative_employee?: string;
}

interface CustomerRecord {
  customer_id: string;
  customer_name: string;
  invoice_paths?: string;
}

interface EmployeeRecord {
  index?: string;
  category?: string;
  description?: string;
}

interface EmailRecord {
  email_id: string;
  thread_id?: string;
  date: string;
  sender_name?: string;
  sender_email?: string;
  recipient_name?: string;
  subject: string;
  body: string;
  importance?: string;
  category?: string;
}

interface ConversationRecord {
  conversation_id: string;
  sender_emp_id?: string;
  recipient_emp_id?: string;
  date: string;
  text: string;
}

interface PostRecord {
  Title: string;
  Post: string;
  emp_id?: string;
  author?: string;
}

interface ItTicketRecord {
  id: string;
  priority?: string;
  raised_by_emp_id?: string;
  assigned_date?: string;
  emp_id?: string;
  Issue?: string;
  Resolution?: string;
}

/* -------------------------------------------------------------------------- *
 * Direct converters
 * -------------------------------------------------------------------------- */

function clientToDrafts(c: ClientRecord): FactDraft[] {
  const slug = clientSlug(c.business_name);
  const observed = parseDateOrNow(c.onboarding_date);
  const ref = `qontext:client:${c.client_id}`;
  const drafts: FactDraft[] = [];

  if (c.industry) {
    drafts.push({
      entity: slug,
      claim: `${c.business_name} operates in industry: ${c.industry}.`,
      metric: { key: 'industry', value: c.industry },
      sourceRef: ref,
      sourceExcerpt: `client: ${c.business_name}, industry: ${c.industry}`,
      observedAt: observed,
    });
  }
  if (c.business_type) {
    drafts.push({
      entity: slug,
      claim: `${c.business_name} relationship type: ${c.business_type}.`,
      metric: { key: 'relationship_type', value: c.business_type },
      sourceRef: ref,
      sourceExcerpt: `business_type: ${c.business_type}`,
      observedAt: observed,
    });
  }
  if (c.monthly_revenue) {
    drafts.push({
      entity: slug,
      claim: `${c.business_name} monthly revenue: ${c.monthly_revenue}.`,
      metric: {
        key: 'monthly_revenue',
        value: c.monthly_revenue,
      },
      sourceRef: ref,
      sourceExcerpt: `monthly_revenue: ${c.monthly_revenue}`,
      observedAt: observed,
    });
  }
  if (c.current_POC_product) {
    drafts.push({
      entity: slug,
      claim: `${c.business_name} current POC product: ${c.current_POC_product} (status: ${c.POC_status ?? 'unknown'}).`,
      metric: {
        key: 'poc_product',
        value: c.current_POC_product,
        unit: c.POC_status,
      },
      sourceRef: ref,
      sourceExcerpt: `POC: ${c.current_POC_product} (${c.POC_status ?? 'unknown'})`,
      observedAt: observed,
    });
  }
  if (c.contact_person_name) {
    drafts.push({
      entity: slug,
      claim: `${c.business_name} primary contact: ${c.contact_person_name}${c.contact_email ? ` <${c.contact_email}>` : ''}.`,
      metric: {
        key: 'primary_contact',
        value: c.contact_person_name,
      },
      sourceRef: ref,
      sourceExcerpt: `contact: ${c.contact_person_name}${c.contact_email ? `, ${c.contact_email}` : ''}`,
      observedAt: observed,
    });
  }
  return drafts;
}

function vendorToDrafts(v: VendorRecord): FactDraft[] {
  const slug = clientSlug(v.business_name);
  const observed = parseDateOrNow(v.onboarding_date);
  const ref = `qontext:vendor:${v.client_id}`;
  const drafts: FactDraft[] = [];
  // Use the SAME metric keys as clientToDrafts so the conflict detector
  // clusters them. When the same business shows up in both clients.json
  // and vendors.json with different industry, Canon surfaces it as a
  // user-pickable conflict — that's the cross-source-corroboration demo
  // beat lifted directly out of the customer's own data.
  if (v.industry) {
    drafts.push({
      entity: slug,
      claim: `${v.business_name} operates in industry: ${v.industry} (per vendor record).`,
      metric: { key: 'industry', value: v.industry },
      sourceRef: ref,
      sourceExcerpt: `vendor record: ${v.business_name}, industry: ${v.industry}`,
      observedAt: observed,
    });
  }
  if (v.business_type) {
    drafts.push({
      entity: slug,
      claim: `${v.business_name} relationship type: ${v.business_type} (per vendor record).`,
      metric: { key: 'relationship_type', value: v.business_type },
      sourceRef: ref,
      sourceExcerpt: `vendor relationship_type: ${v.business_type}`,
      observedAt: observed,
    });
  }
  if (v.relationship_description) {
    drafts.push({
      entity: slug,
      claim: `${v.business_name} vendor scope: ${v.relationship_description}`,
      metric: { key: 'vendor_scope', value: 'documented' },
      sourceRef: ref,
      sourceExcerpt: v.relationship_description.slice(0, 200),
      observedAt: observed,
    });
  }
  return drafts;
}

function customerToDrafts(c: CustomerRecord): FactDraft[] {
  const slug = clientSlug(c.customer_name);
  const ref = `qontext:customer:${c.customer_id}`;
  const observed = new Date().toISOString();
  return [
    {
      entity: slug,
      claim: `${c.customer_name} is a retail customer (id ${c.customer_id}).`,
      metric: { key: 'customer_type', value: 'retail' },
      sourceRef: ref,
      sourceExcerpt: `customer_id: ${c.customer_id}, name: ${c.customer_name}`,
      observedAt: observed,
    },
  ];
}

function employeeToDrafts(e: EmployeeRecord): FactDraft[] {
  const desc = (e.description ?? '').slice(0, 240);
  // Find the person's name from the description (typical first-sentence pattern).
  const nameMatch = desc.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
  if (!nameMatch) return [];
  const fullName = nameMatch[1];
  const slug = clientSlug(fullName);
  const ref = `qontext:employee:${e.index ?? slug}`;
  return [
    {
      entity: slug,
      claim: `${fullName} (${e.category ?? 'unknown category'}) — ${desc.split(/\.\s/)[0]}.`,
      metric: { key: 'role_category', value: e.category ?? 'unknown' },
      sourceRef: ref,
      sourceExcerpt: desc.slice(0, 200),
      observedAt: new Date().toISOString(),
    },
  ];
}

function postToDrafts(p: PostRecord): FactDraft[] {
  // Each post is its own fact, not a competing claim of one global
  // 'social_post' metric. Emit as a loose fact (no metric key) so the
  // conflict detector doesn't group them as a fake N-way conflict.
  const ref = `qontext:post:${p.emp_id ?? slugify(p.Title)}`;
  return [
    {
      entity: COMPANY_SLUG,
      claim: `Social post: "${p.Title}" — ${(p.Post ?? '').slice(0, 200).replace(/\s+/g, ' ').trim()}`,
      sourceRef: ref,
      sourceExcerpt: (p.Post ?? '').slice(0, 240),
      observedAt: new Date().toISOString(),
    },
  ];
}

function itTicketToDrafts(t: ItTicketRecord): FactDraft[] {
  // Each ticket emits two facts: one about the raiser (emp_id of the
  // user reporting the issue), one about the assignee (the IT person
  // who resolved it). This creates natural cross-source links — the
  // same emp_id may appear in employees.json + emails + conversations
  // + this ticket, layering provenance across systems.
  const ref = `qontext:it_ticket:${t.id}`;
  const observed = parseDateOrNow(t.assigned_date);
  const issueShort = (t.Issue ?? '').replace(/\s+/g, ' ').slice(0, 200);
  const resoShort = (t.Resolution ?? '').replace(/\s+/g, ' ').slice(0, 200);
  const drafts: FactDraft[] = [];
  if (t.raised_by_emp_id) {
    drafts.push({
      entity: t.raised_by_emp_id,
      claim: `Raised IT ticket #${t.id} (${t.priority ?? 'unknown'} priority): ${issueShort}`,
      metric: { key: 'open_tickets_raised', value: t.id },
      sourceRef: ref,
      sourceExcerpt: issueShort,
      observedAt: observed,
    });
  }
  if (t.emp_id) {
    drafts.push({
      entity: t.emp_id,
      claim: `Assigned IT ticket #${t.id}: ${resoShort || issueShort}`,
      metric: { key: 'assigned_tickets', value: t.id },
      sourceRef: ref,
      sourceExcerpt: resoShort || issueShort,
      observedAt: observed,
    });
  }
  return drafts;
}

/**
 * Read up to `max` policy PDFs from Policy_Documents/, extract per-page text
 * via the same pdf-parse-v2 pipeline that ingests Q1's board deck, and emit
 * Chunks. Sampled deterministically for demo reproducibility.
 */
async function loadPolicyPdfChunks(max: number): Promise<Chunk[]> {
  if (max <= 0) return [];
  const policyDir = path.join(DATA_ROOT, 'Policy_Documents');
  const { readdir } = await import('node:fs/promises');
  let entries: string[] = [];
  try {
    entries = await readdir(policyDir);
  } catch {
    return [];
  }
  const pdfs = entries
    .filter((f) => f.toLowerCase().endsWith('.pdf') && !f.startsWith('._'))
    .sort();
  const sampled = pickSample(pdfs, max);

  const { PDFParse } = await import('pdf-parse');
  const chunks: Chunk[] = [];
  for (const filename of sampled) {
    try {
      const decoded = decodeURIComponent(filename);
      const buf = await readFile(path.join(policyDir, filename));
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      const result = await parser.getText();
      const pages = (result.pages ?? []) as Array<{ text?: string }>;
      pages.forEach((p, idx) => {
        const text = (p.text ?? '').replace(/\s+/g, ' ').trim();
        if (text.length < 60) return;
        chunks.push({
          text,
          sourceRef: `qontext:policy:${slugify(decoded.replace(/\.pdf$/i, ''))}#p${idx + 1}`,
          observedAt: new Date().toISOString(),
          sourceExcerpt: text.slice(0, 240),
          defaultEntity: COMPANY_SLUG,
        });
      });
    } catch (e) {
      console.warn(`[qontext] policy ${filename} skipped:`, (e as Error).message);
    }
  }
  return chunks;
}

/* -------------------------------------------------------------------------- *
 * Pipeline-via-Pioneer converters
 * -------------------------------------------------------------------------- */

function emailToChunks(e: EmailRecord): Chunk[] {
  // Each email = 1 chunk. Subject + first 600 chars of body.
  const text = `${e.subject}. ${(e.body ?? '').replace(/\s+/g, ' ').slice(0, 600)}`;
  return [
    {
      text,
      sourceRef: `qontext:email:${e.email_id}`,
      observedAt: parseDateOrNow(e.date),
      sourceExcerpt: text.slice(0, 240),
      defaultEntity: COMPANY_SLUG,
    },
  ];
}

function conversationToChunks(c: ConversationRecord): Chunk[] {
  const text = (c.text ?? '').replace(/\s+/g, ' ').slice(0, 800);
  return [
    {
      text,
      sourceRef: `qontext:conversation:${c.conversation_id}`,
      observedAt: parseDateOrNow(c.date),
      sourceExcerpt: text.slice(0, 240),
      defaultEntity: COMPANY_SLUG,
    },
  ];
}

/* -------------------------------------------------------------------------- *
 * Helpers
 * -------------------------------------------------------------------------- */

async function readJson<T>(rel: string): Promise<T> {
  const buf = await readFile(path.join(DATA_ROOT, rel), 'utf-8');
  return JSON.parse(buf) as T;
}

function pickSample<T>(arr: T[], n: number): T[] {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= n) return arr.slice();
  // Deterministic sampling: take evenly-spaced indices so the demo
  // is reproducible across runs.
  const step = Math.floor(arr.length / n);
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[i * step]);
  return out;
}

function clientSlug(name: string | undefined): string {
  return slugify(name ?? 'unknown').slice(0, 32);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseDateOrNow(input: string | undefined): string {
  if (!input) return new Date().toISOString();
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
