/**
 * PDF source adapter — extracts text per page, splits per slide,
 * hands off to Pioneer for entity+metric extraction.
 *
 * Uses pdf-parse v2 (PDFParse class API). Each page becomes one chunk.
 *
 * Path-traversal hardening (Aikido AIK_ts_generic_path_traversal, CWE-23):
 * `pdfPath` is constrained to files under the project's `demo/` directory.
 * `readFile` only sees absolute paths whose realpath sits inside the allowed
 * root, so callers that take untrusted input cannot cause file-disclosure.
 */

import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FactDraft } from '../canon/types';
import { extractFactsFromChunks, type Chunk } from '../canon/pioneer';

export interface PdfIngestResult {
  filename: string;
  pageCount: number;
  drafts: FactDraft[];
}

const DEMO_ROOT = path.resolve(process.cwd(), 'demo');
const DEFAULT_PDF = path.resolve(DEMO_ROOT, 'q1-board-deck.pdf');

async function safeResolveInsideDemo(input: string): Promise<string> {
  const abs = path.isAbsolute(input) ? input : path.resolve(DEMO_ROOT, input);
  // Realpath both sides — symlinks must not escape the allowed root either.
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    throw new Error(`pdfPath does not exist: ${path.basename(abs)}`);
  }
  const root = await realpath(DEMO_ROOT);
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new Error('pdfPath must resolve inside the demo/ directory');
  }
  if (!real.toLowerCase().endsWith('.pdf')) {
    throw new Error('pdfPath must point to a .pdf file');
  }
  return real;
}

export async function ingestPdf(opts?: {
  pdfPath?: string;
  observedAt?: string;
}): Promise<PdfIngestResult> {
  const requested = opts?.pdfPath ?? DEFAULT_PDF;
  const pdfPath = await safeResolveInsideDemo(requested);
  const filename = path.basename(pdfPath);
  const buf = await readFile(pdfPath);

  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();

  const pages = (result.pages ?? []) as Array<{ text?: string; pageNumber?: number }>;
  const observedAt = opts?.observedAt ?? new Date().toISOString();
  const chunks = pagesToChunks(filename, pages, observedAt);
  const drafts = await extractFactsFromChunks(chunks);
  return { filename, pageCount: result.total ?? pages.length, drafts };
}

function pagesToChunks(
  filename: string,
  pages: Array<{ text?: string; pageNumber?: number }>,
  observedAt: string,
): Chunk[] {
  return pages
    .map((p, idx) => {
      const pageNum = p.pageNumber ?? idx + 1;
      const text = (p.text ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return {
        text,
        sourceRef: `pdf:${filename}:p${pageNum}`,
        observedAt,
        sourceExcerpt: text.slice(0, 240),
        // Board deck is Northwind's own — slides about Q1 MRR / pipeline
        // belong to `northwind` even when no customer is named on the page.
        defaultEntity: 'northwind',
      } as Chunk;
    })
    .filter((c): c is Chunk => c !== null);
}
