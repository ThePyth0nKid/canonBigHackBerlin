/**
 * PDF source adapter — extracts text per page, splits per slide,
 * hands off to Pioneer for entity+metric extraction.
 *
 * Uses pdf-parse v2 (PDFParse class API). Each page becomes one chunk.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FactDraft } from '../canon/types';
import { extractFactsFromChunks, type Chunk } from '../canon/pioneer';

export interface PdfIngestResult {
  filename: string;
  pageCount: number;
  drafts: FactDraft[];
}

const DEFAULT_PDF = path.resolve(process.cwd(), 'demo/q1-board-deck.pdf');

export async function ingestPdf(opts?: {
  pdfPath?: string;
  observedAt?: string;
}): Promise<PdfIngestResult> {
  const pdfPath = opts?.pdfPath ?? DEFAULT_PDF;
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
