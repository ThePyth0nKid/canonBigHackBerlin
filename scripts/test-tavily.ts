import 'dotenv/config';
import { searchExternal } from '../src/lib/canon/tavily';

async function main() {
  console.log('Testing Tavily with a clean query...\n');
  const r = await searchExternal('Northwind Software ACME enterprise SaaS', { maxResults: 3 });
  console.log('latencyMs:', r.latencyMs);
  console.log('synthesis:', r.synthesis?.slice(0, 200));
  console.log('items:', r.items.length);
  for (const i of r.items) {
    console.log('  -', i.title, '·', i.url);
    console.log('    excerpt:', i.excerpt.slice(0, 100));
    console.log('    unsigned:', i.unsigned, '· source:', i.source);
  }
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
