import 'dotenv/config';
import { ingestSlackChannel } from '../src/lib/ingest/slack';
import { ingestGmail } from '../src/lib/ingest/gmail';
import { ingestPdf } from '../src/lib/ingest/pdf';
import { prisma } from '../src/lib/prisma';

async function main() {
  const slack = await ingestSlackChannel();
  console.log('=== SLACK ===');
  for (const d of slack.drafts) {
    console.log(JSON.stringify({ e: d.entity, m: d.metric, x: d.sourceExcerpt.slice(0, 140) }));
  }

  const pdf = await ingestPdf();
  console.log('\n=== PDF ===');
  for (const d of pdf.drafts) {
    console.log(JSON.stringify({ e: d.entity, m: d.metric, x: d.sourceExcerpt.slice(0, 140) }));
  }

  const acct = await prisma.account.findFirst({
    where: { provider: 'google', access_token: { not: null } },
    orderBy: { id: 'desc' },
  });
  if (acct) {
    const r = await ingestGmail({
      accessToken: acct.access_token!,
      refreshToken: acct.refresh_token,
      expiresAt: acct.expires_at,
    });
    console.log('\n=== GMAIL ===');
    for (const d of r.drafts) {
      console.log(JSON.stringify({ e: d.entity, m: d.metric, x: d.sourceExcerpt.slice(0, 140) }));
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
