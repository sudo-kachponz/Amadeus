/**
 * RAG retrieval + generation — enhanced pipeline with hybrid search,
 * citations, confidence gating, and answer cleaning.
 *
 * Delegates retrieval to ragRetrieval.ts (hybrid dense + BM25 + RRF)
 * and ingestion to ragIngest.ts (heading-aware chunking). This file
 * owns the generation prompt and answer post-processing.
 */

import { netraChat } from './netraClient.js';
import { embedText, embedTexts } from './embeddingClient.js';
import { query } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { hybridSearch, type RankedChunk, type RetrievalResult } from './ragRetrieval.js';
import { ingestDocument, type IngestChunk } from './ragIngest.js';
import { rebuildBm25Index } from './bm25.js';

// ─── Legacy exports (backward compat) ─────────────────────────────────

export interface RetrievedDoc {
  file_id: string;
  content: string;
  similarity: number;
}

/**
 * Fixed-size chunking with overlap — kept for backward compat with existing
 * data that was ingested the old way. New uploads go through ingestDocument().
 */
export function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  const step = chunkSize - overlap;
  for (let start = 0; start < normalized.length; start += step) {
    chunks.push(normalized.slice(start, start + chunkSize));
    if (start + chunkSize >= normalized.length) break;
  }
  return chunks;
}

/** Legacy ingest — simple character chunking for plain text. */
export async function ingestFile(
  fileId: string,
  userId: string | null,
  text: string,
): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;

  const embeddings = await embedTexts(chunks);
  for (let i = 0; i < chunks.length; i++) {
    await query(
      `INSERT INTO rag_documents (user_id, file_id, content, embedding, chunk_index) VALUES ($1, $2, $3, $4::vector, $5)`,
      [userId, fileId, chunks[i], JSON.stringify(embeddings[i]), i],
    );
  }
  await rebuildBm25Index();
  return chunks.length;
}

/** Smart ingest — heading-aware chunking with metadata extraction. */
export async function ingestDocumentSmart(
  fileId: string,
  userId: string | null,
  buffer: Buffer,
  filename: string,
): Promise<{ chunks: number; docTitle: string }> {
  const result = await ingestDocument(fileId, userId, buffer, filename);
  await rebuildBm25Index();
  return result;
}

export async function deleteFileChunks(fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await query(`DELETE FROM rag_documents WHERE file_id = ANY($1)`, [fileIds]);
  await rebuildBm25Index();
}

// ─── Retrieval (delegates to hybrid search) ───────────────────────────

export async function retrievalWithRerank(
  userQuery: string,
  topK = 5,
  history?: { role: string; content: string }[],
): Promise<RetrievalResult> {
  return hybridSearch(userQuery, { topK, history });
}

// ─── Citations ────────────────────────────────────────────────────────

export interface Citation {
  ref: number;
  fileId: string;
  docTitle: string | null;
  docType: string | null;
  section: string | null;
  heading: string | null;
  startPage: number | null;
  endPage: number | null;
  similarity: number;
}

function buildCitations(chunks: RankedChunk[]): Citation[] {
  return chunks.map((c, i) => ({
    ref: i + 1,
    fileId: c.fileId,
    docTitle: c.docTitle,
    docType: c.docType,
    section: c.section,
    heading: c.heading,
    startPage: c.startPage,
    endPage: c.endPage,
    similarity: Math.round(c.similarity * 1000) / 1000,
  }));
}

// ─── Context formatting ───────────────────────────────────────────────

function formatContext(chunks: RankedChunk[]): string {
  return chunks
    .map((c, i) => {
      const parts = [c.docTitle ?? 'Dokumen'];
      if (c.section) parts.push(c.section);
      if (c.heading) parts.push(c.heading);
      const pages = c.startPage != null
        ? c.startPage === c.endPage
          ? `hal. ${c.startPage}`
          : `hal. ${c.startPage}-${c.endPage}`
        : '';
      const header = `[${i + 1}] ${parts.join(' | ')}${pages ? `, ${pages}` : ''}`;
      return `${header}\n${c.content}`;
    })
    .join('\n\n');
}

// ─── System prompt ────────────────────────────────────────────────────

const FALLBACK_MESSAGE =
  'Mohon maaf, saya tidak menemukan informasi yang relevan untuk pertanyaan tersebut di dokumen yang saya miliki.';

const SYSTEM_PROMPT = `Kamu adalah asisten AI yang menjawab pertanyaan berdasarkan REFERENSI yang diberikan.

ATURAN:
1. Jawab dalam Bahasa Indonesia yang jelas dan lengkap.
2. Tulis angka, syarat, dan ketentuan PERSIS seperti di referensi. Jangan mengarang atau membulatkan.
3. Setiap fakta diberi nomor sitasi [1] sampai [N] sesuai referensi sumbernya.
4. Bila referensi sama sekali tidak membahas topik yang ditanyakan, jawab: "${FALLBACK_MESSAGE}"
5. Jawab langsung dan tidak bertele-tele. Untuk prosedur, tulis langkah bernomor.
6. Akhiri setiap kalimat fakta dengan nomor sitasi dalam kurung siku, mis. [1] atau [2, 3].`;

// ─── Answer cleaning ──────────────────────────────────────────────────

const CITATION_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

function cleanAnswer(text: string, nRefs: number): string {
  // Fix out-of-range citations
  let cleaned = text.replace(CITATION_RE, (match, nums: string) => {
    const valid = nums
      .split(',')
      .map((n: string) => parseInt(n.trim(), 10))
      .filter((n: number) => n >= 1 && n <= nRefs);
    return valid.length > 0 ? `[${valid.join(', ')}]` : '';
  });

  // Strip false fallback appended after substantive answer
  if (cleaned.includes(FALLBACK_MESSAGE)) {
    const before = cleaned.split(FALLBACK_MESSAGE)[0] ?? '';
    if (CITATION_RE.test(before) || before.trim().length >= 150) {
      cleaned = before.replace(/\s*(Jadi,?\s*)?$/, '').trimEnd();
    }
  }

  return cleaned.trim();
}

// ─── Generation ───────────────────────────────────────────────────────

export interface RagResponse {
  answer: string;
  citations: Citation[];
  fallback: boolean;
  retrieval: RetrievalResult;
}

export async function generateRagResponse(
  userQuery: string,
  retrievedContext?: RetrievedDoc[],
  history?: { role: string; content: string }[],
): Promise<string | RagResponse> {
  // Legacy path: if called with old-style RetrievedDoc[], use simple generation
  if (retrievedContext) {
    const formattedContext = retrievedContext
      .map(
        (doc, i) =>
          `Document ${i + 1} (ID: ${doc.file_id}, Relevance: ${doc.similarity.toFixed(4)}):\n${doc.content}`,
      )
      .join('\n\n');
    const prompt = `Berdasarkan konteks yang diambil berikut, jawab pertanyaan ini.\n\nPertanyaan: ${userQuery}\n\nKonteks:\n${formattedContext}\n\nJawaban:`;
    const result = await netraChat({
      model: env.NETRA_LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      callSite: 'rag',
    });
    return result.content;
  }

  // Enhanced path: hybrid retrieval + citations + answer cleaning
  const retrieval = await hybridSearch(userQuery, { topK: 5, history });

  if (!retrieval.confident) {
    return {
      answer: FALLBACK_MESSAGE,
      citations: [],
      fallback: true,
      retrieval,
    };
  }

  const citations = buildCitations(retrieval.chunks);
  const context = formatContext(retrieval.chunks);

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `REFERENSI:\n${context}\n\nPERTANYAAN: ${userQuery}`,
    },
  ];

  const result = await netraChat({
    model: env.NETRA_LLM_MODEL,
    messages,
    temperature: 0.1,
    callSite: 'rag',
  });

  const answer = cleanAnswer(result.content, retrieval.chunks.length);

  return {
    answer,
    citations,
    fallback: answer.includes(FALLBACK_MESSAGE),
    retrieval,
  };
}
