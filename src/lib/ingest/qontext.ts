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
  maxCustomers?: number;
  maxEmployees?: number;
  maxEmails?: number;
  maxConversations?: number;
  maxPosts?: number;
}

const DEFAULT_LIMITS: Required<QontextLimits> = {
  maxClients: 8,
  maxCustomers: 5,
  maxEmployees: 6,
  maxEmails: 12,
  maxConversations: 6,
  maxPosts: 4,
};

export interface QontextIngestResult {
  /** Direct structured FactDrafts that skip Pioneer. */
  directDrafts: FactDraft[];
  /** Chunks that should be fed through extractFactsFromChunks(). */
  pipelineChunks: Chunk[];
  counts: {
    clients: number;
    customers: number;
    employees: number;
    emails: number;
    conversations: number;
    posts: number;
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
    customers: 0,
    employees: 0,
    emails: 0,
    conversations: 0,
    posts: 0,
  };

  // 1. Clients — B2B engagements (richest entity records).
  try {
    const clients = await readJson<ClientRecord[]>(
      'Business_and_Management/clients.json',
    );
    const sampled = pickSample(clients, lim.maxClients);
    for (const c of sampled) {
      directDrafts.push(...clientToDrafts(c));
    }
    counts.clients = sampled.length;
  } catch (e) {
    console.warn('[qontext] clients.json skipped:', (e as Error).message);
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
  const ref = `qontext:post:${p.emp_id ?? slugify(p.Title)}`;
  return [
    {
      entity: COMPANY_SLUG,
      claim: `${COMPANY_DISPLAY} social-platform post: "${p.Title}".`,
      metric: { key: 'social_post', value: p.Title },
      sourceRef: ref,
      sourceExcerpt: (p.Post ?? '').slice(0, 240),
      observedAt: new Date().toISOString(),
    },
  ];
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
