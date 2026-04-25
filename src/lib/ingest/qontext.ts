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
  /** Top-N products (by sales frequency) used as the hero set for
   *  cross-source corroboration: catalog + sales + invoices. */
  maxHeroProducts?: number;
  /** Cap of customer-order PDFs to parse for invoice line items. */
  maxInvoices?: number;
}

/** Default sample sizes — tuned to land ~5000 facts in the Inazuma workspace. */
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
  maxHeroProducts: 100,
  maxInvoices: 30,
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
    products: number;
    sales: number;
    invoices: number;
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
    products: 0,
    sales: 0,
    invoices: 0,
  };

  // Pre-load sales to compute hero-product set (top-N by sales frequency).
  // Hero products drive 3-source corroboration: products.json catalog +
  // sales.json transactions + invoice PDFs. The same `product.actual_price`
  // metric appears across all three so the conflict detector clusters them.
  let heroProductIds: Set<string> = new Set();
  let allSalesCached: SaleRecord[] = [];
  let allProductsCached: ProductRecordExt[] = [];
  try {
    allSalesCached = await readJson<SaleRecord[]>(
      'Customer_Relation_Management/sales.json',
    );
    const tally = new Map<string, number>();
    for (const s of allSalesCached) {
      if (!s.product_id) continue;
      tally.set(s.product_id, (tally.get(s.product_id) ?? 0) + 1);
    }
    heroProductIds = new Set(
      [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, lim.maxHeroProducts)
        .map(([id]) => id),
    );
  } catch (e) {
    console.warn('[qontext] sales.json prescan skipped:', (e as Error).message);
  }

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

  // 9. Products catalog — emit fact-rich product records for the hero set.
  // Each hero product produces ~5 facts (name, category, actual/discounted
  // price, rating). Catalog facts cluster with sales + invoice price facts
  // on `product.actual_price` for cross-source corroboration / conflict.
  try {
    if (allProductsCached.length === 0) {
      allProductsCached = await readJson<ProductRecordExt[]>(
        'Customer_Relation_Management/products.json',
      );
    }
    const heroProducts = allProductsCached.filter((p) =>
      heroProductIds.has(p.product_id),
    );
    for (const p of heroProducts) {
      directDrafts.push(...productToDrafts(p));
    }
    counts.products = heroProducts.length;
  } catch (e) {
    console.warn('[qontext] products.json skipped:', (e as Error).message);
  }

  // 10. Sales records — only for hero products. Each sale emits 1 price
  // corroboration fact (entity = product, metric = actual_price). Multiple
  // sales at the same price form natural corroboration clusters; outliers
  // surface as conflicts. Hero filter caps volume to ~10-30 facts/product.
  try {
    const heroSales = allSalesCached.filter((s) => heroProductIds.has(s.product_id));
    for (const s of heroSales) {
      directDrafts.push(...saleToDrafts(s));
    }
    counts.sales = heroSales.length;
  } catch (e) {
    console.warn('[qontext] sales.json skipped:', (e as Error).message);
  }

  // 11. Customer-order PDFs — invoices have a clean tabular shape (Customer
  // header + product line items). Per-line-item we emit one product price
  // fact, joining the same `product.actual_price` cluster as catalog +
  // sales. This is the third corroborating source per hero product.
  try {
    const invoiceDrafts = await loadInvoiceDrafts(lim.maxInvoices);
    for (const d of invoiceDrafts) directDrafts.push(d);
    // Count distinct invoice files via sourceRef prefix.
    const seenInvoices = new Set<string>();
    for (const d of invoiceDrafts) {
      seenInvoices.add(d.sourceRef.split('#')[0]);
    }
    counts.invoices = seenInvoices.size;
  } catch (e) {
    console.warn('[qontext] invoices skipped:', (e as Error).message);
  }

  return { directDrafts, pipelineChunks, counts };
}

/* -------------------------------------------------------------------------- *
 * Record types — exported so the live-upload route can reuse the same
 * typed mappers when the user drops a Qontext-shaped JSON file in.
 * -------------------------------------------------------------------------- */

export interface ClientRecord {
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

export interface VendorRecord {
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

export interface CustomerRecord {
  customer_id: string;
  customer_name: string;
  invoice_paths?: string;
}

export interface EmployeeRecord {
  index?: string;
  category?: string;
  description?: string;
}

export interface EmailRecord {
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

export interface ConversationRecord {
  conversation_id: string;
  sender_emp_id?: string;
  recipient_emp_id?: string;
  date: string;
  text: string;
}

export interface PostRecord {
  Title: string;
  Post: string;
  emp_id?: string;
  author?: string;
}

export interface ItTicketRecord {
  id: string;
  priority?: string;
  raised_by_emp_id?: string;
  assigned_date?: string;
  emp_id?: string;
  Issue?: string;
  Resolution?: string;
}

export interface ProductRecordExt {
  product_id: string;
  product_name?: string;
  category?: string;
  discounted_price?: string;
  actual_price?: string;
  rating?: string;
  about_product?: string;
}

export interface SaleRecord {
  product_id: string;
  discounted_price?: string;
  actual_price?: string;
  discount_percentage?: string;
  customer_id?: string;
  Date_of_Purchase?: string;
  sales_record_id: number;
}

/* -------------------------------------------------------------------------- *
 * Direct converters
 * -------------------------------------------------------------------------- */

export function clientToDrafts(c: ClientRecord): FactDraft[] {
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
    // Email is intentionally excluded from claim+excerpt: scan.ts redacts any
    // address outside ALLOWED_EMAIL_DOMAINS, and per PIPELINE.md the redacted
    // claim is replaced wholesale ("Original NEVER persisted"). Keeping the
    // email here would lose the entire fact. The contact NAME is the useful
    // datum and stays in metric.value.
    drafts.push({
      entity: slug,
      claim: `${c.business_name} primary contact: ${c.contact_person_name}.`,
      metric: {
        key: 'primary_contact',
        value: c.contact_person_name,
      },
      sourceRef: ref,
      sourceExcerpt: `contact: ${c.contact_person_name}`,
      observedAt: observed,
    });
  }
  return drafts;
}

export function vendorToDrafts(v: VendorRecord): FactDraft[] {
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

export function customerToDrafts(c: CustomerRecord): FactDraft[] {
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

export function employeeToDrafts(e: EmployeeRecord): FactDraft[] {
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

export function postToDrafts(p: PostRecord): FactDraft[] {
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

export function itTicketToDrafts(t: ItTicketRecord): FactDraft[] {
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

export function productToDrafts(p: ProductRecordExt): FactDraft[] {
  if (!p.product_id) return [];
  const slug = `product_${slugify(p.product_id)}`;
  const ref = `qontext:product:${p.product_id}`;
  // Catalog has no per-record date; use a deterministic anchor so re-ingests
  // produce the same hash chain. The full Inazuma sample is anchored at the
  // dataset's nominal "as-of" point — change once if you reload from a new
  // Qontext snapshot.
  const observed = '2024-01-01T00:00:00.000Z';
  const drafts: FactDraft[] = [];

  if (p.product_name) {
    const name = p.product_name.replace(/\s+/g, ' ').trim();
    drafts.push({
      entity: slug,
      claim: `Product ${p.product_id}: ${name.slice(0, 120)}.`,
      metric: { key: 'name', value: name.slice(0, 80) },
      sourceRef: ref,
      sourceExcerpt: `product_id: ${p.product_id}, name: ${name.slice(0, 160)}`,
      observedAt: observed,
    });
  }
  if (p.category) {
    const top = p.category.split('|')[0]?.replace(/[;,]+$/, '').trim() ?? p.category;
    drafts.push({
      entity: slug,
      claim: `Product ${p.product_id} category: ${top}.`,
      metric: { key: 'category', value: top.slice(0, 60) },
      sourceRef: ref,
      sourceExcerpt: `category: ${p.category.slice(0, 160)}`,
      observedAt: observed,
    });
  }
  if (p.actual_price) {
    const norm = normalizeRupeePrice(p.actual_price);
    drafts.push({
      entity: slug,
      claim: `Product ${p.product_id} catalog actual price: ${p.actual_price}.`,
      metric: { key: 'actual_price', value: norm.value, unit: norm.unit },
      sourceRef: ref,
      sourceExcerpt: `catalog actual_price: ${p.actual_price}`,
      observedAt: observed,
    });
  }
  if (p.discounted_price) {
    const norm = normalizeRupeePrice(p.discounted_price);
    drafts.push({
      entity: slug,
      claim: `Product ${p.product_id} catalog discounted price: ${p.discounted_price}.`,
      metric: { key: 'discounted_price', value: norm.value, unit: norm.unit },
      sourceRef: ref,
      sourceExcerpt: `catalog discounted_price: ${p.discounted_price}`,
      observedAt: observed,
    });
  }
  if (p.rating) {
    drafts.push({
      entity: slug,
      claim: `Product ${p.product_id} catalog rating: ${p.rating}.`,
      metric: { key: 'rating', value: p.rating },
      sourceRef: ref,
      sourceExcerpt: `rating: ${p.rating}`,
      observedAt: observed,
    });
  }
  return drafts;
}

export function saleToDrafts(s: SaleRecord): FactDraft[] {
  // One sale → one corroborating product-price fact. Multiple sales at the
  // same price form a corroboration cluster on `product.actual_price`;
  // outliers surface as conflicts. Customer-purchase facts are intentionally
  // NOT emitted here — they would either flood as N-way conflicts (one
  // metric_key, many product values) or pollute with per-purchase keys.
  if (!s.product_id || !s.actual_price) return [];
  const productSlug = `product_${slugify(s.product_id)}`;
  const ref = `qontext:sale:${s.sales_record_id}`;
  const observed = parseDateOrNow(s.Date_of_Purchase);
  const norm = normalizeRupeePrice(s.actual_price);
  return [
    {
      entity: productSlug,
      claim: `Sale of product ${s.product_id} at ${s.actual_price}${s.Date_of_Purchase ? ` on ${s.Date_of_Purchase}` : ''}.`,
      metric: { key: 'actual_price', value: norm.value, unit: norm.unit },
      sourceRef: ref,
      sourceExcerpt: `sale_record_${s.sales_record_id}: customer ${s.customer_id ?? '?'}, actual_price ${s.actual_price}, date ${s.Date_of_Purchase ?? '?'}`,
      observedAt: observed,
    },
  ];
}

/**
 * Parse a customer-order PDF (invoice / purchase order / shipping order)
 * and emit FactDrafts for each line item. Invoice format is fixed:
 *   "Invoice for Customer ID: alfki"
 *   "Customer Name: maria anders"
 *   table rows: <product_id>  ...  ■<discounted>  ■<actual>  <category>
 * The product IDs anchor each row; we tolerate text wrapping by extracting
 * each row's prices from the same physical line as the product ID.
 */
async function loadInvoiceDrafts(max: number): Promise<FactDraft[]> {
  if (max <= 0) return [];
  const ordersDir = path.join(
    DATA_ROOT,
    'Customer_Relation_Management',
    'Customer_orders',
  );
  const { readdir } = await import('node:fs/promises');
  let entries: string[] = [];
  try {
    entries = await readdir(ordersDir);
  } catch {
    return [];
  }
  const pdfs = entries
    .filter((f) => f.toLowerCase().endsWith('.pdf') && !f.startsWith('._'))
    .sort();
  const sampled = pickSample(pdfs, max);

  const { PDFParse } = await import('pdf-parse');
  const drafts: FactDraft[] = [];
  for (const filename of sampled) {
    try {
      const buf = await readFile(path.join(ordersDir, filename));
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      const result = await parser.getText();
      const text = result.text ?? '';
      drafts.push(...parseInvoiceText(filename, text));
    } catch (e) {
      console.warn(`[qontext] invoice ${filename} skipped:`, (e as Error).message);
    }
  }
  return drafts;
}

function parseInvoiceText(filename: string, text: string): FactDraft[] {
  // Filename anchors the customer ID: invoice_<id>.pdf, purchase_order_<id>.pdf,
  // shipping_order_<id>.pdf. Falls back to header parse if filename doesn't match.
  const fnameMatch = filename.match(/^(?:invoice|purchase_order|shipping_order)_([a-z0-9]+)\.pdf$/i);
  const headerCustomer = fnameMatch?.[1] ?? text.match(/Customer ID:\s*([A-Za-z0-9_-]+)/i)?.[1] ?? null;
  const docKind = filename.startsWith('invoice') ? 'invoice'
    : filename.startsWith('purchase_order') ? 'purchase_order'
    : filename.startsWith('shipping_order') ? 'shipping_order'
    : 'order_doc';
  const ref = `qontext:${docKind}:${headerCustomer ?? slugify(filename)}`;
  // Anchor invoices on the dataset's nominal as-of point (the PDFs carry no
  // explicit date). Same anchor as products.json for cross-source clustering.
  const observed = '2024-01-01T00:00:00.000Z';

  // Each line item: ANCHOR on a product id, then pull the next two
  // currency-prefixed numbers on the same row as discounted + actual.
  // The currency glyph is encoded inconsistently across the dataset:
  //   - ■  raw bullet (some PDFs)
  //   - ₹  proper rupee  (rare)
  //   - n  pdf-parse loses the rupee font mapping → renders as Latin n
  //         (the bulk of Customer_orders/*.pdf)
  // Lookbehind ensures we don't match `n` mid-word.
  const drafts: FactDraft[] = [];
  const PRODUCT_ID_RE = /\b(B[A-Z0-9]{9,11})\b/g;
  const PRICE_PAIR_RE = /(?:[■₹]|(?<![a-zA-Z])n)\s*(\d[\d,]*)\s+(?:[■₹]|(?<![a-zA-Z])n)\s*(\d[\d,]*)/;
  let m: RegExpExecArray | null;
  const seenAtSourceRef = new Set<string>();
  while ((m = PRODUCT_ID_RE.exec(text)) !== null) {
    const productId = m[1];
    // Look forward up to 600 chars for the two prices on this row.
    // 600 covers the multi-line product name + category wrap that sits
    // between the product id and its price pair in pdf-parse output.
    const window = text.slice(m.index, m.index + 600);
    const priceMatch = window.match(PRICE_PAIR_RE);
    if (!priceMatch) continue;
    const discounted = priceMatch[1];
    const actual = priceMatch[2];

    const lineKey = `${ref}#${productId}`;
    // PDFs sometimes repeat the same product id across pages; dedupe.
    if (seenAtSourceRef.has(lineKey)) continue;
    seenAtSourceRef.add(lineKey);

    const productSlug = `product_${slugify(productId)}`;
    const normActual = normalizeRupeePrice(`■${actual}`);
    drafts.push({
      entity: productSlug,
      claim: `${docKind.replace('_', ' ')} for customer ${headerCustomer ?? '?'}: product ${productId} at ₹${actual}.`,
      metric: { key: 'actual_price', value: normActual.value, unit: normActual.unit },
      sourceRef: lineKey,
      sourceExcerpt: `${docKind} ${filename} for ${headerCustomer ?? '?'}: ${productId}, discounted ₹${discounted}, actual ₹${actual}`,
      observedAt: observed,
    });
  }
  return drafts;
}

/** Strip ₹ / ■ + commas, return numeric string + 'INR' unit. */
function normalizeRupeePrice(raw: string): { value: string; unit: string } {
  const digits = raw.replace(/[₹■,\s]/g, '').trim();
  return { value: digits || raw, unit: 'INR' };
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

export function emailToChunks(e: EmailRecord): Chunk[] {
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

export function conversationToChunks(c: ConversationRecord): Chunk[] {
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

export function clientSlug(name: string | undefined): string {
  return slugify(name ?? 'unknown').slice(0, 32);
}

export function slugify(s: string): string {
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
