/**
 * Heading-aware document ingestion pipeline for RAG.
 * Port of mandiri-click-ai-assistant/ingest_spo_pto.py concepts.
 *
 * Replaces the naive character-based chunkText() with:
 * - Per-page PDF text extraction
 * - Noise filtering (headers, footers, watermarks, TOC)
 * - Heading-aware chunking with overlap
 * - Rich metadata per chunk (section, heading, pages)
 * - Table row normalization for structured data
 */

import { query } from '../../db/pool.js';
import { embedTexts } from './embeddingClient.js';
import { netraChat } from './netraClient.js';
import { env } from '../../config/env.js';

// ─── Types ────────────────────────────────────────────────────────────

interface PageText {
  page: number;
  lines: string[];
}

interface ParsedLine {
  text: string;
  page: number;
  section: string;
  heading: string;
}

export interface IngestChunk {
  content: string;
  section: string;
  heading: string;
  startPage: number;
  endPage: number;
  chunkIndex: number;
}

// ─── Noise filtering ──────────────────────────────────────────────────

const NOISE_PATTERNS = [
  /^\d{10}\s*-\s*\d{2}\/\d{2}\/\d{4}/,         // watermark NIP + date
  /^BANK MANDIRI$/i,
  /^BMRI Classification:/i,
  /^Standar Prosedur Sumber Daya Manusia/i,
  /^PETUNJUK TEKNIS\s*(SUMBER DAYA MANUSIA)?$/i,
  /^Diverifikasi oleh:/i,
  /^Edisi\s*(ke)?\s*:/i,
  /^Revisi ke\s*:/i,
  /^Berlaku (sejak|mulai) tanggal/i,
  /^Tanggal yang digantikan/i,
  /^(L\d+\s*[–-]\s*[A-Z]?\s*[–-]?\s*\d+|[IVX]+\s*[–-]\s*([A-Z]\s*[–-]\s*)?\d+|[ivx]+)$/,
  /^Page \d+ of \d+$/i,
  /^\d{1,3}$/,                                    // lone page numbers
];

const TOC_MARKER = /DAFTAR ISI|TABLE OF CONTENTS/i;
const TOC_LINE = /(L\d+\s*[–-]\s*[A-Z]\s*[–-]\s*\d+|[IVX]+\s*[–-]\s*([A-Z]\s*[–-]\s*)?\d+)\s*$|^(Pasal \d+[a-z]?|BAB [IVX]+)\b.*\s\d{1,3}$|^\d{1,3}$/;

function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(line));
}

function isTocPage(lines: string[]): boolean {
  if (lines.length === 0) return false;
  if (lines.some((l) => TOC_MARKER.test(l))) return true;
  return lines.filter((l) => TOC_LINE.test(l)).length / lines.length >= 0.3;
}

function findRepeatedLines(pages: string[][], minRatio = 0.15): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const unique = new Set(lines);
    for (const l of unique) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.floor(pages.length * minRatio));
  const repeated = new Set<string>();
  for (const [line, n] of counts) {
    if (n >= threshold) repeated.add(line);
  }
  return repeated;
}

// ─── Heading detection ────────────────────────────────────────────────

const SECTION_HEADER = /^(BAB\s+[IVX]+\b|LAMPIRAN\s+\d+\b)[^.]*$/;
const ARTICLE_HEADING = /^Pasal \d+[a-z]?\b/;

const HEADING_PATTERNS: [RegExp, number][] = [
  [ARTICLE_HEADING, 0],
  [/^[A-Z]\.\s+[A-Z]/, 1],
  [/^\d{1,2}[.)]\s+[A-Z]/, 2],
];

function detectHeading(line: string): number | null {
  const words = line.split(/\s+/);
  if (words.length > 9 || /[.,;:\-]$/.test(line) || /=|\bRp\b|\d{3}\.\d{3}/.test(line)) return null;
  for (const [pat, level] of HEADING_PATTERNS) {
    if (pat.test(line)) return level;
  }
  return null;
}

// ─── Table detection & normalization ─────────────────────────────────
// Two-tier: regex for simple tables, LLM fallback for complex ones.

const TABLE_SEPARATOR = /\t|\s{3,}|\|/;
const AMOUNT_RE = /\d{1,3}(?:\.\d{3})+|\d+(?:[,.]\d+)*\s*%/;
const BORDER_LINE = /^[\s\-=+|_]{4,}$/;

function isTableRegion(lines: string[]): boolean {
  let tabularCount = 0;
  for (const line of lines) {
    const parts = line.split(TABLE_SEPARATOR).filter(Boolean);
    if (parts.length >= 3 || BORDER_LINE.test(line)) tabularCount++;
  }
  return tabularCount >= 3 && tabularCount / lines.length >= 0.4;
}

function regexNormalizeTable(lines: string[]): string[] {
  const out: string[] = [];
  let headerCols: string[] | null = null;

  for (const line of lines) {
    if (BORDER_LINE.test(line)) continue;
    const parts = line.split(TABLE_SEPARATOR).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3 && !parts.some((p) => AMOUNT_RE.test(p))) {
      headerCols = parts;
      out.push(line);
      continue;
    }
    if (headerCols && parts.length >= 2 && parts.some((p) => AMOUNT_RE.test(p))) {
      const label = parts[0];
      const values = parts.slice(1);
      const pairs = values.map((v, i) => {
        const col = headerCols && i < headerCols.length ? headerCols[i + 1] ?? '' : '';
        return col ? `${col} = ${v}` : v;
      });
      out.push(`• ${label}: ${pairs.join('; ')}`);
      continue;
    }
    out.push(line);
  }
  return out;
}

const TABLE_EXTRACT_PROMPT = `Kamu mengekstrak data dari tabel dalam dokumen. Diberikan teks mentah dari area tabel (mungkin tidak rapi), konversi menjadi format terstruktur yang jelas.

Format output:
- Setiap baris data: "• [Label/Nama]: [Kolom1] = [Nilai1]; [Kolom2] = [Nilai2]"
- Jika ada total/subtotal, tulis: "TOTAL: [nilai]"
- Pertahankan angka dan satuan PERSIS seperti aslinya
- Jika tidak bisa diparsing, kembalikan teks asli apa adanya

Jawab HANYA dengan teks terstruktur, tanpa penjelasan.`;

async function llmExtractTable(rawText: string): Promise<string> {
  try {
    const result = await netraChat({
      model: env.NETRA_LLM_MODEL,
      messages: [
        { role: 'system', content: TABLE_EXTRACT_PROMPT },
        { role: 'user', content: rawText.slice(0, 2000) },
      ],
      temperature: 0,
      callSite: 'rag-table-extract',
    });
    return result.content.trim();
  } catch {
    return rawText;
  }
}

async function normalizeTableRows(lines: string[]): Promise<string[]> {
  if (!isTableRegion(lines)) return regexNormalizeTable(lines);

  const regexResult = regexNormalizeTable(lines);
  // ponytail: if regex produced clean bullet points, trust it
  const bulletCount = regexResult.filter((l) => l.startsWith('•')).length;
  if (bulletCount >= 2) return regexResult;

  // Complex table — LLM fallback
  const rawBlock = lines.join('\n');
  const extracted = await llmExtractTable(rawBlock);
  return extracted.split('\n').filter(Boolean);
}

// ─── PDF text extraction ──────────────────────────────────────────────

export async function extractPdfPages(buffer: Buffer): Promise<PageText[]> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const pages: PageText[] = [];

  try {
    const result = await parser.getText();
    // Split by form feed characters (page boundaries in pdf-parse output)
    const rawPages = result.text.split('\f');
    for (let i = 0; i < rawPages.length; i++) {
      const raw = rawPages[i] ?? '';
      const lines = raw
        .split('\n')
        .map((l: string) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (lines.length > 0) pages.push({ page: i + 1, lines });
    }
  } finally {
    await parser.destroy().catch(() => {});
  }

  return pages;
}

export function extractPlainTextPages(text: string): PageText[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [{ page: 1, lines }];
}

// ─── Core chunking ────────────────────────────────────────────────────

async function parseLines(pages: PageText[]): Promise<ParsedLine[]> {
  const allPageLines = pages.map((p) => p.lines);
  const repeated = findRepeatedLines(allPageLines);
  const parsed: ParsedLine[] = [];
  let section = '';
  const headings = ['', '', ''];

  for (const page of pages) {
    if (isTocPage(page.lines)) continue;

    const normalized = await normalizeTableRows(page.lines);
    for (const text of normalized) {
      if (SECTION_HEADER.test(text)) {
        if (text !== section) {
          section = text;
          headings[0] = headings[1] = headings[2] = '';
        }
        continue;
      }
      if (repeated.has(text) || isNoise(text)) continue;

      const level = detectHeading(text);
      if (level !== null) {
        headings[level] = text;
        for (let d = level + 1; d < headings.length; d++) headings[d] = '';
      }

      parsed.push({
        text,
        page: page.page,
        section,
        heading: headings.filter(Boolean).join(' > '),
      });
    }
  }
  return parsed;
}

export async function chunkByHeading(pages: PageText[]): Promise<IngestChunk[]> {
  const maxChars = env.RAG_CHUNK_MAX_CHARS;
  const overlap = env.RAG_CHUNK_OVERLAP_CHARS;
  const lines = await parseLines(pages);
  const chunks: IngestChunk[] = [];

  let current: ParsedLine[] = [];
  let currentLen = 0;

  function flush(keepOverlap: boolean): ParsedLine[] {
    if (current.length > 0) {
      const first = current[0]!;
      const last = current[current.length - 1]!;
      chunks.push({
        content: current.map((l) => l.text).join('\n'),
        section: first.section,
        heading: first.heading,
        startPage: first.page,
        endPage: last.page,
        chunkIndex: chunks.length,
      });
    }
    if (!keepOverlap) return [];
    const carry: ParsedLine[] = [];
    let carryLen = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      const item = current[i]!;
      if (carryLen + item.text.length > overlap) break;
      carry.unshift(item);
      carryLen += item.text.length;
    }
    return carry;
  }

  for (const line of lines) {
    const lineLen = line.text.length;
    const lastLine = current.length > 0 ? current[current.length - 1]! : null;

    if (lastLine && line.section !== lastLine.section) {
      current = flush(false);
      currentLen = 0;
    } else if (ARTICLE_HEADING.test(line.text) && currentLen >= 40) {
      current = flush(false);
      currentLen = current.reduce((s, l) => s + l.text.length, 0);
    } else if (detectHeading(line.text) !== null && currentLen >= maxChars * 0.5) {
      current = flush(false);
      currentLen = current.reduce((s, l) => s + l.text.length, 0);
    } else if (currentLen + lineLen > maxChars) {
      current = flush(true);
      currentLen = current.reduce((s, l) => s + l.text.length, 0);
    }

    current.push(line);
    currentLen += lineLen;
  }
  flush(false);
  return chunks;
}

// ─── Ingest orchestrator ──────────────────────────────────────────────

export async function ingestDocument(
  fileId: string,
  userId: string | null,
  buffer: Buffer,
  filename: string,
): Promise<{ chunks: number; docTitle: string }> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const isPdf = ext === 'pdf';

  const pages = isPdf
    ? await extractPdfPages(buffer)
    : extractPlainTextPages(buffer.toString('utf8'));

  const docTitle = filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  const docType = isPdf ? 'pdf' : ext;
  const chunks = await chunkByHeading(pages);

  if (chunks.length === 0) return { chunks: 0, docTitle };

  const texts = chunks.map((c) => {
    const header = `[${docTitle}${c.section ? ` | ${c.section}` : ''}${c.heading ? ` | ${c.heading}` : ''}]`;
    return `${header}\n${c.content}`;
  });

  const BATCH = 64;
  let total = 0;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const batchChunks = chunks.slice(i, i + BATCH);
    const embeddings = await embedTexts(batch);

    for (let j = 0; j < batch.length; j++) {
      const c = batchChunks[j]!;
      const text = batch[j]!;
      const emb = embeddings[j]!;
      await query(
        `INSERT INTO rag_documents
          (user_id, file_id, content, embedding, doc_title, doc_type, section, heading, start_page, end_page, chunk_index, metadata)
         VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          userId,
          fileId,
          text,
          JSON.stringify(emb),
          docTitle,
          docType,
          c.section || null,
          c.heading || null,
          c.startPage,
          c.endPage,
          c.chunkIndex,
          JSON.stringify({}),
        ],
      );
      total++;
    }
  }

  return { chunks: total, docTitle };
}
