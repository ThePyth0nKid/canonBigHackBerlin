/**
 * Extends the Canon demo dataset with deeper Northwind story material.
 *
 * Adds ~12 more Slack messages (#sales in test-canon) and ~6 more Gmail
 * emails (via Resend, drafts@ultranova.io → nelson@ultranova.io). All
 * facts are story-consistent with the Northwind bible:
 *   - Customers: ACME, TechCo, Globex, Initech, Soylent, Umbrella
 *   - Numbers: per the canonical demo (Q1 €127k, pipeline €444k, etc.)
 *   - New conflict beats: Globex per-seat pricing renegotiation, Soylent
 *     seat-count ambiguity (12 vs 14), ACME implementation timeline.
 *
 * Usage:
 *   npx tsx scripts/seed-extra-data.mjs           # dry-run preview
 *   npx tsx scripts/seed-extra-data.mjs --send    # actually post + email
 */

import 'dotenv/config';

const SLACK_TOKEN = process.env.SLACK_USER_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_DEMO_CHANNEL ?? 'C0B058UN0PK';
const RESEND_KEY = process.env.RESEND_API_KEY ?? 're_eJXbQftA_H2kSo5LUndL1ux9E2rue4Nrx';
const FROM = 'Canon Demo Seeder <drafts@ultranova.io>';
const TO = 'nelson@ultranova.io';

const SEND = process.argv.includes('--send');

// ---------------------------------------------------------------------------
// Slack messages — chronological story extensions, posted with 3s spacing
// ---------------------------------------------------------------------------
const SLACK_MESSAGES = [
  // Wave 1 — earlier in the week, customer health signals
  `Globex update: 22 seats annual, €4,400/mo MRR, healthy. Renewal 2026-08-30, no friction expected.`,
  `Initech still on monthly — 18 seats × €200 = €3,600 MRR. They keep pushing back on annual conversion. Lina, can you frame the 17% annual discount story for next Tuesday?`,
  `Soylent active in Q1 — 12 seats × €200/mo = €2,400 MRR. Upsell conversation open: they want SSO + audit log, would justify €400/seat tier.`,

  // Wave 2 — Globex pricing conflict (fresh demo conflict beat)
  `Heads up: Globex AE asking for €180/seat instead of €200. Competitor (Acumetrics) quoted them €175. We could match but margin is tight — let's hold at €200.`,
  `Counter-offer for Globex: €190/seat with 24-month commit. Lina, run it past their procurement Tuesday. That preserves €4,180/mo MRR, only 5% concession.`,
  `Globex came back: they'll do €190/seat, 24-month commit, 25 seats. ACV jumps to €57k/year. Renewal moved to 2026-09-15.`,

  // Wave 3 — Soylent seat ambiguity
  `Soylent procurement just sent a new PO: 14 seats not 12. Lina checked — they added 2 contractors mid-Q1. Per-seat stays €200/mo, MRR now €2,800.`,
  `Wait Soylent's onboarding says 12 active users still. Need to reconcile before close — either 12 active + 2 dormant or actual 14 active. Asked customer success.`,

  // Wave 4 — Q2 plan / hiring
  `Q2 ask from board: Hire AE #3 (€85k base + variable), ship ENG-412 (billing integration v1), target Q2 exit MRR €152k. AE candidate Marcus reviewed yesterday — strong, mid-market focus.`,
  `Budget is approved for AE #3. Start date 2026-06-01. Lina + Marcus will run the AE-onboarding playbook from Q4 2025. Ramp expected ~75 days.`,

  // Wave 5 — competitive intel + small wins
  `Three new logos in Q1 closed combined €45k ARR — Acmecorp, Northstar, Linnea Studios. All annual contracts. Acmecorp is the largest at €24k.`,
  `Heads-up: TechCo's competitor (the billing-integrated one) just raised €30M Series B. They'll lean harder into our base. ENG-412 priority confirmed for Q2.`,

  // Wave 6 — ACME implementation timeline conflict (the third major demo conflict)
  `Petra (ACME procurement) wants implementation complete by 2026-05-15 to align with billing cycle. Greg (account lead) flagged: "Realistically we'll need until end of June for full SSO + custom field mapping."`,
];

// ---------------------------------------------------------------------------
// Gmail emails — story-consistent, sent via Resend
// ---------------------------------------------------------------------------
const GMAIL_EMAILS = [
  {
    subject: '[canon-demo] Q2 plan + board ask — internal',
    bodyHeader: { from: 'Marcus Weil <marcus@northwind.co>', date: '2026-04-23' },
    body: `From: Marcus Weil <marcus@northwind.co>
Date: 2026-04-23
To: leadership@northwind.co

Team,

Q2 plan locked after this morning's sync:

- Hire AE #3, target start 2026-06-01, mid-market focus
- Ship ENG-412 (billing-integration v1) — addresses TechCo-style churn
- Target Q2 exit MRR: €152,000 (+20% QoQ)
- Pipeline weighted: €444k ARR, conviction medium-high
- Hold pricing at €2,400/seat/year for ACME-tier; revisit pricing refresh memo separately

Board ask Thursday:
1. Approval AE #3 hire (budgeted)
2. Two prospect intros (finance vertical list attached separately)
3. Sign-off on pricing-refresh memo

— Marcus
`,
  },

  {
    subject: '[canon-demo] Globex pricing renegotiation — closed',
    bodyHeader: { from: 'Lina Hofer <lina@northwind.co>', date: '2026-04-23' },
    body: `From: Lina Hofer <lina@northwind.co>
Date: 2026-04-23
To: revenue@northwind.co

Update on Globex (was: pricing pushback):

Final terms:
- 25 seats annual (up from 22)
- €190/seat/year (down from €200)
- 24-month commit
- Renewal date moved to 2026-09-15
- New ACV €4,750/mo MRR ≈ €57,000/year

Net impact: +€350/mo MRR over their old contract despite the €10/seat concession, due to the 3-seat expansion. Acumetrics stays in the picture but Globex confirmed they're staying with us.

— Lina
`,
  },

  {
    subject: '[canon-demo] Initech annual conversion — pitch deck',
    bodyHeader: { from: 'Lina Hofer <lina@northwind.co>', date: '2026-04-22' },
    body: `From: Lina Hofer <lina@northwind.co>
Date: 2026-04-22
To: jens@northwind.co
Subject: [canon-demo] Initech annual conversion — pitch deck

Jens,

For the Initech meeting Tuesday — recommended pitch:
- Current: 18 seats × €200/mo = €3,600 MRR (monthly billing)
- Proposed: 18 seats × €2,000/year = €36,000 ACV (annual)
- 17% discount vs. monthly run-rate
- They keep their flexibility on net-new seats; we lock the base for 12 months

Win condition: convert by 2026-05-31 to lock Q2.

— Lina
`,
  },

  {
    subject: '[canon-demo] ACME implementation timeline — concern',
    bodyHeader: { from: 'Greg Mueller <greg@northwind.co>', date: '2026-04-24' },
    body: `From: Greg Mueller <greg@northwind.co>
Date: 2026-04-24
To: jens@northwind.co
Cc: lina@northwind.co

Jens,

Quick flag re: ACME. Petra wants implementation complete by 2026-05-15 to match
their billing cycle. Realistically we need until end of June for full SSO and
their custom field mapping (10 custom fields, 3 conditional flows).

Options:
1. Soft-launch by 05-15 with manual SSO, full integration by end of June (preferred)
2. Push renewal date to 2026-06-30, start billing then
3. Phased: 30 seats at 05-15, full 50 by 06-30

Recommend option 1. Will discuss with Petra Friday.

— Greg
`,
  },

  {
    subject: '[canon-demo] Soylent — seat count reconciliation',
    bodyHeader: { from: 'Customer Success <cs@northwind.co>', date: '2026-04-23' },
    body: `From: Customer Success <cs@northwind.co>
Date: 2026-04-23
To: lina@northwind.co

Hi Lina,

You asked about Soylent seat count. Per our usage logs:
- 12 active users (logged in last 30 days)
- 2 inactive (added late Q1, not yet onboarded)

Soylent's procurement says 14 seats. Both numbers true depending on definition.
For invoicing-purposes, 14 seats is correct (per their PO). For Canon-MRR
reporting we should track 14 × €200/mo = €2,800 MRR. Will memo finance.

— CS team
`,
  },

  {
    subject: '[canon-demo] Three new logos closed Q1 — recap',
    bodyHeader: { from: 'Lina Hofer <lina@northwind.co>', date: '2026-04-21' },
    body: `From: Lina Hofer <lina@northwind.co>
Date: 2026-04-21
To: leadership@northwind.co

For the board:

Q1 closes (annual contracts):
- Acmecorp: €24,000 ARR (10 seats annual)
- Northstar: €12,000 ARR (5 seats annual)
- Linnea Studios: €9,000 ARR (4 seats annual, with consulting add-on)

Combined: €45,000 ARR added in Q1. All onboarding complete, NPS pending Q2.

Next milestones: Acmecorp evaluating expansion to 15 seats by Q3.

— Lina
`,
  },
];

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

async function postSlackMessage(text) {
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: SLACK_CHANNEL, text, as_user: true }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`slack: ${j.error}`);
  return j.ts;
}

async function sendGmail(email) {
  const html = email.body.replace(/\n/g, '<br>');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      subject: email.subject,
      text: email.body,
      html,
    }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`resend: ${JSON.stringify(j)}`);
  return j.id;
}

async function main() {
  if (!SLACK_TOKEN) throw new Error('SLACK_USER_TOKEN missing');
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY missing');

  console.log(`\n=== Canon demo extension seeder ===`);
  console.log(`mode: ${SEND ? 'SEND (live)' : 'DRY RUN (preview only)'}`);
  console.log(`slack: ${SLACK_MESSAGES.length} messages → #sales (${SLACK_CHANNEL})`);
  console.log(`gmail: ${GMAIL_EMAILS.length} emails  → ${TO}`);
  console.log('');

  // Slack
  console.log('--- Slack ---');
  for (let i = 0; i < SLACK_MESSAGES.length; i++) {
    const m = SLACK_MESSAGES[i];
    const preview = m.length > 80 ? m.slice(0, 77) + '…' : m;
    if (SEND) {
      try {
        const ts = await postSlackMessage(m);
        console.log(`  ${(i + 1).toString().padStart(2)}. ✓ ts=${ts}  ${preview}`);
      } catch (e) {
        console.log(`  ${(i + 1).toString().padStart(2)}. ✗ ${e.message}`);
      }
      // 3s spacing for realistic-ish timestamps
      await new Promise((r) => setTimeout(r, 3000));
    } else {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${preview}`);
    }
  }

  // Gmail
  console.log('\n--- Gmail ---');
  for (let i = 0; i < GMAIL_EMAILS.length; i++) {
    const email = GMAIL_EMAILS[i];
    if (SEND) {
      try {
        const id = await sendGmail(email);
        console.log(`  ${(i + 1).toString().padStart(2)}. ✓ id=${id}  ${email.subject}`);
      } catch (e) {
        console.log(`  ${(i + 1).toString().padStart(2)}. ✗ ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    } else {
      console.log(`  ${(i + 1).toString().padStart(2)}. ${email.subject}`);
    }
  }

  console.log('');
  if (!SEND) console.log('Re-run with --send to actually post.');
  else console.log('Done. Run /api/sync (or sync-smoke.ts) to ingest the new content.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
