import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION;

if (!project || !location) {
  console.error('missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION');
  process.exit(1);
}

const ai = new GoogleGenAI({ vertexai: true, project, location });

async function probe(model) {
  const t0 = Date.now();
  try {
    const r = await ai.models.generateContent({
      model,
      contents: 'Reply with just: canon-ok',
    });
    const text = r.text?.trim() ?? '<no text>';
    return { model, ok: true, text, ms: Date.now() - t0 };
  } catch (e) {
    return { model, ok: false, error: e.message?.split('\n')[0]?.slice(0, 140) };
  }
}

console.log(`project=${project} location=${location}\n`);
for (const m of ['gemini-2.5-flash', 'gemini-2.5-pro']) {
  const r = await probe(m);
  if (r.ok) console.log(`✓ ${r.model.padEnd(20)} ${r.ms}ms  reply: ${r.text}`);
  else console.log(`✗ ${r.model.padEnd(20)} ${r.error}`);
}
