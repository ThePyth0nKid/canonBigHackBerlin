import 'dotenv/config';
import { ingestPdf } from '../src/lib/ingest/pdf';

async function main() {
  // Test path-traversal blocking BEFORE the legit call so we don't need
  // a working Pioneer API key (the rejection happens in ingestPdf before
  // any network).
  try {
    await ingestPdf({ pdfPath: '../../../etc/passwd' });
    console.log('FAIL: traversal allowed');
  } catch (e) {
    console.log('OK blocked relative ../etc/passwd:', (e as Error).message);
  }

  try {
    await ingestPdf({ pdfPath: '/etc/passwd' });
    console.log('FAIL: absolute /etc allowed');
  } catch (e) {
    console.log('OK blocked absolute /etc/passwd:', (e as Error).message);
  }

  console.log('legit demo PDF would extract from demo/ root: skipped (Pioneer-API call would follow)');
}
main();
