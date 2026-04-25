/**
 * Demo seed: live ingest dry-run.
 *
 * Sends N emails via Resend (to CANON_DEMO_TO) and N Slack posts via the
 * existing SLACK_USER_TOKEN. Each message is hand-tuned to interact with
 * the Inazuma ledger in a specific way, so when the user clicks Sync on
 * canon.ultranova.io the audience sees three distinct visible reactions:
 *
 *   1. Corroboration  — new fact agrees with an existing cluster, the
 *                       confirming-source count ticks up
 *   2. Conflict       — new fact disagrees, "Resolve" button appears
 *   3. New entity     — entity/metric pair Canon has not seen
 *
 * Each piece of content explicitly names a known Inazuma cast member
 * (Miller Group, Gonzalez Inc, Johnson Group, Huang LLC, …) so Pioneer
 * canonicalises the entity and the new fact joins the right cluster.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-data.ts                  # both
 *   npx tsx scripts/seed-demo-data.ts --gmail-only
 *   npx tsx scripts/seed-demo-data.ts --slack-only
 *   npx tsx scripts/seed-demo-data.ts --dry-run        # print, don't send
 */

import 'dotenv/config';
import { Resend } from 'resend';

const TO = process.env.CANON_DEMO_TO ?? 'nelson@ultranova.io';
const DOMAIN = process.env.EMAIL_FROM_DOMAIN ?? 'ultranova.io';

interface DemoEmail {
  /** Local-part — full address becomes <local>@<EMAIL_FROM_DOMAIN>. */
  fromLocal: string;
  fromName: string;
  subject: string;
  body: string;
  /** Story-beat for the demo log so the host knows what to point at. */
  beat: 'corroborate' | 'conflict' | 'new';
  /** Which entity this targets (for the run summary). */
  targets: string;
}

interface DemoSlack {
  text: string;
  beat: DemoEmail['beat'];
  targets: string;
}

const EMAILS: DemoEmail[] = [
  {
    fromLocal: 'cfo',
    fromName: 'CFO · Inazuma',
    subject: '[canon-demo] Miller Group industry classification — confirming Manufacturing',
    body: `Quick confirmation for the records:

Miller Group is in the Manufacturing industry. Their POC and the contract terms both match.
Cross-checked against the vendor master data — Manufacturing is the right tag.

— CFO`,
    beat: 'corroborate',
    targets: 'miller_group.industry = Manufacturing (existing cluster grows)',
  },
  {
    fromLocal: 'sales-ops',
    fromName: 'Sales Ops · Inazuma',
    subject: '[canon-demo] Gonzalez Inc — Enterprise relationship reconfirmed',
    body: `Aligned with account management today.

Gonzalez Inc is an Enterprise relationship. They've been on Enterprise terms for 18 months.
No change in tier despite the recent pricing review.

— Sales Ops`,
    beat: 'corroborate',
    targets: 'gonzalez_inc.relationship_type = Enterprise (corroborates corroborated)',
  },
  {
    fromLocal: 'support-lead',
    fromName: 'Support Lead · Inazuma',
    subject: '[canon-demo] Heads-up: Miller Group is actually in Healthcare',
    body: `Noticed an inconsistency that someone should resolve.

Per the latest customer call notes Miller Group is in the Healthcare industry, not Manufacturing.
Their procurement is run out of a hospital network. Worth reconciling with the master data.

— Support Lead`,
    beat: 'conflict',
    targets: 'miller_group.industry = Healthcare (NEW disagreeing value → conflict)',
  },
  {
    fromLocal: 'biz-dev',
    fromName: 'BizDev · Inazuma',
    subject: '[canon-demo] New customer signed: Bright Plc — Enterprise tier',
    body: `Closing the loop on the Bright Plc deal.

Bright Plc just signed as a new customer. Relationship type: Enterprise.
First POC kicks off next week — Voice Commerce Assistant integration.

— BizDev`,
    beat: 'new',
    targets: 'bright_plc.relationship_type / poc_product (NEW entity in ledger)',
  },
  {
    fromLocal: 'product',
    fromName: 'Product · Inazuma',
    subject: '[canon-demo] Johnson Group POC update — Voice Commerce Assistant on track',
    body: `Quick status from the POC review.

Johnson Group's POC of the Voice Commerce Assistant is on track. Go-live targeted for next quarter.
Their team has been a strong design partner.

— Product`,
    beat: 'corroborate',
    targets: 'johnson_group.poc_product = Voice Commerce Assistant (corroborates corroborated)',
  },
];

const SLACK_POSTS: DemoSlack[] = [
  {
    text: `Quick FYI: had the Huang LLC monthly today. Solid call. They're operating in the Logistics industry — confirming their vendor profile.`,
    beat: 'corroborate',
    targets: 'huang_llc.industry = Logistics',
  },
  {
    text: `Heads-up team — Williams Group is now also a vendor relationship for us, not just a client. Two-sided account.`,
    beat: 'corroborate',
    targets: 'williams_group dual-role corroboration',
  },
  {
    text: `News from the contract review: Gonzalez Inc is moving from Enterprise to SMB tier next quarter. Significant change.`,
    beat: 'conflict',
    targets: 'gonzalez_inc.relationship_type = SMB (NEW disagreeing value → conflict)',
  },
  {
    text: `Just signed a new customer: Bright Plc. POC starts with Voice Commerce Assistant. Same product as Johnson Group runs.`,
    beat: 'new',
    targets: 'bright_plc + corroborates voice_commerce_assistant',
  },
  {
    text: `Pricing reminder for everyone: Inazuma standard per-seat-price is €120/yr for the Voice Commerce Assistant tier. Don't quote anything different without checking with me.`,
    beat: 'new',
    targets: 'inazuma.per_seat_price (NEW org-wide metric)',
  },
];

async function sendEmails(dryRun: boolean): Promise<void> {
  console.log(`\n=== Resend → ${TO} (from @${DOMAIN}) ===\n`);
  if (!process.env.RESEND_API_KEY && !dryRun) {
    throw new Error('RESEND_API_KEY missing');
  }
  const resend = dryRun ? null : new Resend(process.env.RESEND_API_KEY);

  for (const e of EMAILS) {
    const fromAddr = `${e.fromName} <${e.fromLocal}@${DOMAIN}>`;
    console.log(`[${e.beat.padEnd(11)}] ${e.fromLocal}@: "${e.subject}"`);
    console.log(`    targets: ${e.targets}`);
    if (dryRun) continue;
    const r = await resend!.emails.send({
      from: fromAddr,
      to: TO,
      subject: e.subject,
      text: e.body,
    });
    if (r.error) {
      console.log(`    → ERROR: ${r.error.message}`);
    } else {
      console.log(`    → sent id=${r.data?.id}`);
    }
    // Tiny delay to keep the audience-visible "stream of new messages" feel.
    await sleep(250);
  }
}

async function postSlack(dryRun: boolean): Promise<void> {
  const channel = process.env.SLACK_DEMO_CHANNEL ?? 'C0B058UN0PK';
  const token = process.env.SLACK_USER_TOKEN;
  console.log(`\n=== Slack → ${channel} ===\n`);
  if (!token && !dryRun) throw new Error('SLACK_USER_TOKEN missing');

  for (const m of SLACK_POSTS) {
    console.log(`[${m.beat.padEnd(11)}] "${m.text.slice(0, 72)}…"`);
    console.log(`    targets: ${m.targets}`);
    if (dryRun) continue;
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, text: m.text }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string; ts?: string };
    if (!data.ok) {
      console.log(`    → ERROR: ${data.error}`);
    } else {
      console.log(`    → posted ts=${data.ts}`);
    }
    await sleep(250);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const gmailOnly = args.has('--gmail-only');
  const slackOnly = args.has('--slack-only');

  if (!slackOnly) await sendEmails(dryRun);
  if (!gmailOnly) await postSlack(dryRun);

  console.log('\nDone. Click Sync on canon.ultranova.io to ingest.\n');
  console.log('Expected ledger reactions:');
  console.log('  · 4 corroboration ticks  (cluster confirming-source counts grow)');
  console.log('  · 2 new conflicts        (Miller Group industry, Gonzalez Inc tier)');
  console.log('  · 3 new entities/metrics (Bright Plc, inazuma.per_seat_price, …)\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
