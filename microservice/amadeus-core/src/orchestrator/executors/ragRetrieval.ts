/**
 * Hybrid RAG retrieval: dense (pgvector) + BM25 + RRF + LLM rerank
 * + query decomposition + multi-hop reasoning.
 */

import { query as dbQuery } from '../../db/pool.js';
import { embedText } from './embeddingClient.js';
import { bm25Search } from './bm25.js';
import { netraChat } from './netraClient.js';
import { env } from '../../config/env.js';

// ─── Types ────────────────────────────────────────────────────────────

export interface RankedChunk {
  id: string;
  fileId: string;
  content: string;
  similarity: number;
  score: number;
  docTitle: string | null;
  docType: string | null;
  section: string | null;
  heading: string | null;
  startPage: number | null;
  endPage: number | null;
}

export interface RetrievalResult {
  chunks: RankedChunk[];
  searchQuery: string;
  topSimilarity: number;
  confident: boolean;
  decomposed?: string[];
  multiHopQuery?: string;
}

export interface RetrievalOptions {
  topK?: number;
  history?: { role: string; content: string }[];
  minSimilarity?: number;
}

// ─── Query normalization ──────────────────────────────────────────────

const INFORMAL_MAP: Record<string, string> = {
  dapet: 'dapat', 'dapat gak': 'dapat tidak', gak: 'tidak', ga: 'tidak',
  nggak: 'tidak', ngga: 'tidak', enggak: 'tidak', gk: 'tidak',
  gimana: 'bagaimana', gmn: 'bagaimana', brp: 'berapa', yg: 'yang',
  klo: 'kalau', kalo: 'kalau', aku: 'saya', gue: 'saya', gw: 'saya',
  udah: 'sudah', udh: 'sudah', pengen: 'ingin', pingin: 'ingin',
  bikin: 'membuat', tgl: 'tanggal', bgt: 'banget', sm: 'sama',
  trs: 'terus', org: 'orang', krn: 'karena', tp: 'tapi', bs: 'bisa',
  lg: 'lagi', jg: 'juga', blm: 'belum', dr: 'dari', utk: 'untuk',
};

const INFORMAL_RE = new RegExp(
  '\\b(' + Object.keys(INFORMAL_MAP).sort((a, b) => b.length - a.length).map(escapeRe).join('|') + ')\\b',
  'gi',
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeQuery(q: string): string {
  return q.replace(INFORMAL_RE, (m) => INFORMAL_MAP[m.toLowerCase()] ?? m);
}

// ─── Follow-up resolution ─────────────────────────────────────────────

const FOLLOW_UP_HINTS = /\b(itu|tersebut|nya|kalau|bagaimana dengan|yang tadi|lalu|terus)\b/i;

export function resolveFollowUp(
  currentQuery: string,
  history?: { role: string; content: string }[],
): string {
  if (!history || history.length === 0) return currentQuery;
  if (currentQuery.split(/\s+/).length > 8 && !FOLLOW_UP_HINTS.test(currentQuery)) {
    return currentQuery;
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]!;
    if (msg.role === 'user' && msg.content) {
      return `${msg.content} ${currentQuery}`;
    }
  }
  return currentQuery;
}

// ─── Dense search (pgvector) ──────────────────────────────────────────

interface DenseRow {
  id: string;
  file_id: string;
  content: string;
  similarity: number;
  doc_title: string | null;
  doc_type: string | null;
  section: string | null;
  heading: string | null;
  start_page: number | null;
  end_page: number | null;
}

async function denseSearch(queryEmbedding: number[], topN: number): Promise<DenseRow[]> {
  const result = await dbQuery<DenseRow>(
    `SELECT id, file_id, content,
            1 - (embedding <=> $1::vector) AS similarity,
            doc_title, doc_type, section, heading, start_page, end_page
     FROM rag_documents
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), topN],
  );
  return result.rows;
}

// ─── RRF fusion ───────────────────────────────────────────────────────

function reciprocalRankFusion(
  denseResults: DenseRow[],
  bm25Results: { docId: string; score: number }[],
  k: number,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (let rank = 0; rank < denseResults.length; rank++) {
    const row = denseResults[rank]!;
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (k + rank + 1));
  }
  for (let rank = 0; rank < bm25Results.length; rank++) {
    const hit = bm25Results[rank]!;
    scores.set(hit.docId, (scores.get(hit.docId) ?? 0) + 1 / (k + rank + 1));
  }

  return scores;
}

// ─── Diversity cap ────────────────────────────────────────────────────

function diversify(chunks: RankedChunk[], topK: number, maxPerDoc: number): RankedChunk[] {
  if (maxPerDoc <= 0) return chunks.slice(0, topK);
  const perDoc = new Map<string, number>();
  const picked: RankedChunk[] = [];
  for (const c of chunks) {
    const count = perDoc.get(c.fileId) ?? 0;
    if (count < maxPerDoc) {
      picked.push(c);
      perDoc.set(c.fileId, count + 1);
      if (picked.length === topK) break;
    }
  }
  return picked;
}

// ─── LLM-as-judge reranker ───────────────────────────────────────────

const RERANK_PROMPT = `Kamu adalah judge relevansi dokumen. Diberikan sebuah QUERY dan beberapa DOKUMEN, berikan skor relevansi 0-10 untuk setiap dokumen.

Kriteria:
- 0: sama sekali tidak relevan
- 1-3: menyinggung topik tapi tidak menjawab
- 4-6: cukup relevan, membahas topik terkait
- 7-9: sangat relevan, langsung menjawab query
- 10: jawaban sempurna dan lengkap

Jawab HANYA dalam format JSON array angka, contoh: [8, 3, 7, 5, 9]
Jumlah skor HARUS sama persis dengan jumlah dokumen.`;

async function llmRerank(
  queryText: string,
  chunks: RankedChunk[],
): Promise<RankedChunk[]> {
  if (chunks.length <= 1) return chunks;

  const docsBlock = chunks
    .map((c, i) => `--- DOKUMEN ${i + 1} ---\n${c.content.slice(0, 800)}`)
    .join('\n\n');

  try {
    const result = await netraChat({
      model: env.NETRA_LLM_MODEL,
      messages: [
        { role: 'system', content: RERANK_PROMPT },
        { role: 'user', content: `QUERY: ${queryText}\n\n${docsBlock}` },
      ],
      temperature: 0,
      responseJson: true,
      callSite: 'rag-rerank',
    });

    const raw = result.content.trim();
    const match = /\[[\d\s,.]+\]/.exec(raw);
    if (!match) return chunks;

    const scores: number[] = JSON.parse(match[0]);
    if (scores.length !== chunks.length) return chunks;

    return chunks
      .map((c, i) => ({ ...c, score: (scores[i] ?? 0) / 10 }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return chunks;
  }
}

// ─── #3: Query decomposition ─────────────────────────────────────────
// Complex queries ("bandingkan X vs Y", "apa saja syarat A dan B")
// get split into sub-queries, retrieved independently, then merged.

const DECOMPOSE_PROMPT = `Kamu adalah query analyzer. Tentukan apakah query pengguna PERLU dipecah menjadi sub-query untuk pencarian dokumen yang lebih akurat.

Query PERLU dipecah jika:
- Membandingkan dua hal ("bandingkan X vs Y", "perbedaan A dan B")
- Menanyakan beberapa topik sekaligus ("syarat A dan prosedur B")
- Mengandung kondisi kompleks ("jika X maka Y, bagaimana Z")

Query TIDAK perlu dipecah jika:
- Pertanyaan tunggal sederhana ("apa syarat cuti tahunan?")
- Hanya satu topik/entitas

Jawab dalam JSON:
{"decompose": false} jika tidak perlu dipecah
{"decompose": true, "queries": ["sub-query 1", "sub-query 2"]} jika perlu (maks 3 sub-query)`;

async function decomposeQuery(queryText: string): Promise<string[] | null> {
  if (queryText.split(/\s+/).length < 6) return null;

  try {
    const result = await netraChat({
      model: env.NETRA_LLM_MODEL,
      messages: [
        { role: 'system', content: DECOMPOSE_PROMPT },
        { role: 'user', content: queryText },
      ],
      temperature: 0,
      responseJson: true,
      callSite: 'rag-decompose',
    });

    const parsed = JSON.parse(result.content.trim());
    if (parsed.decompose && Array.isArray(parsed.queries) && parsed.queries.length > 1) {
      return parsed.queries.slice(0, 3) as string[];
    }
    return null;
  } catch {
    return null;
  }
}

// ─── #6: Multi-hop sufficiency check ─────────────────────────────────
// After first retrieval, LLM checks if context is sufficient.
// If not, generates a follow-up query for a second retrieval pass.

const MULTIHOP_PROMPT = `Kamu menganalisis apakah KONTEKS yang ditemukan CUKUP untuk menjawab PERTANYAAN pengguna.

Jika konteks sudah cukup lengkap → {"sufficient": true}
Jika butuh informasi tambahan → {"sufficient": false, "follow_up": "query pencarian tambahan yang spesifik"}

Follow-up query harus:
- Spesifik dan berbeda dari query awal
- Mencari informasi yang BELUM ada di konteks
- Hanya satu query (bukan daftar)

Jawab HANYA dalam JSON.`;

async function checkSufficiency(
  queryText: string,
  chunks: RankedChunk[],
): Promise<string | null> {
  if (chunks.length === 0) return null;

  const contextPreview = chunks
    .slice(0, 3)
    .map((c) => c.content.slice(0, 400))
    .join('\n---\n');

  try {
    const result = await netraChat({
      model: env.NETRA_LLM_MODEL,
      messages: [
        { role: 'system', content: MULTIHOP_PROMPT },
        { role: 'user', content: `PERTANYAAN: ${queryText}\n\nKONTEKS:\n${contextPreview}` },
      ],
      temperature: 0,
      responseJson: true,
      callSite: 'rag-multihop',
    });

    const parsed = JSON.parse(result.content.trim());
    if (!parsed.sufficient && parsed.follow_up && typeof parsed.follow_up === 'string') {
      return parsed.follow_up;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Core retrieval (no decomposition/multi-hop) ─────────────────────

async function hybridSearchCore(
  searchQuery: string,
  options: RetrievalOptions,
): Promise<{ chunks: RankedChunk[]; topSimilarity: number }> {
  const topK = options.topK ?? 5;
  const candidates = env.RAG_RETRIEVAL_CANDIDATES;
  const rrfK = env.RAG_RRF_K;

  const queryEmbedding = await embedText(searchQuery);

  const [denseResults, bm25Results] = await Promise.all([
    denseSearch(queryEmbedding, candidates),
    Promise.resolve(bm25Search(searchQuery, candidates)),
  ]);

  const rowById = new Map<string, DenseRow>();
  for (const r of denseResults) rowById.set(r.id, r);

  const missingIds = bm25Results
    .map((b) => b.docId)
    .filter((id) => !rowById.has(id));

  if (missingIds.length > 0) {
    const placeholders = missingIds.map((_, i) => `$${i + 1}`).join(',');
    const extra = await dbQuery<DenseRow>(
      `SELECT id, file_id, content,
              1 - (embedding <=> $${missingIds.length + 1}::vector) AS similarity,
              doc_title, doc_type, section, heading, start_page, end_page
       FROM rag_documents WHERE id IN (${placeholders})`,
      [...missingIds, JSON.stringify(queryEmbedding)],
    );
    for (const r of extra.rows) rowById.set(r.id, r);
  }

  const rrfScores = reciprocalRankFusion(denseResults, bm25Results, rrfK);

  const allChunks: RankedChunk[] = [];
  for (const [id, score] of rrfScores) {
    const row = rowById.get(id);
    if (!row) continue;
    allChunks.push({
      id, fileId: row.file_id, content: row.content, similarity: row.similarity,
      score, docTitle: row.doc_title, docType: row.doc_type, section: row.section,
      heading: row.heading, startPage: row.start_page, endPage: row.end_page,
    });
  }
  allChunks.sort((a, b) => b.score - a.score);

  const rerankCandidates = allChunks.slice(0, env.RAG_RERANK_CANDIDATES);
  const reranked = env.RAG_RERANK_ENABLED
    ? await llmRerank(searchQuery, rerankCandidates)
    : rerankCandidates;

  const diversified = diversify(reranked, topK, env.RAG_MAX_CHUNKS_PER_DOC);

  const topSimilarity = diversified.length > 0
    ? Math.max(...diversified.map((c) => c.similarity))
    : 0;

  return { chunks: diversified, topSimilarity };
}

// ─── Dedup across multiple retrieval passes ──────────────────────────

function dedup(chunks: RankedChunk[]): RankedChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// ─── Public: full pipeline ───────────────────────────────────────────

export async function hybridSearch(
  userQuery: string,
  options: RetrievalOptions = {},
): Promise<RetrievalResult> {
  const topK = options.topK ?? 5;
  const minSimilarity = options.minSimilarity ?? env.RAG_MIN_SIMILARITY;
  const searchQuery = normalizeQuery(resolveFollowUp(userQuery, options.history));

  // ── Query decomposition ──
  const subQueries = env.RAG_DECOMPOSE_ENABLED ? await decomposeQuery(searchQuery) : null;

  let merged: RankedChunk[];
  let topSimilarity: number;

  if (subQueries && subQueries.length > 1) {
    const results = await Promise.all(
      subQueries.map((sq) => hybridSearchCore(sq, options)),
    );
    const all = dedup(results.flatMap((r) => r.chunks));
    all.sort((a, b) => b.score - a.score);
    merged = diversify(all, topK, env.RAG_MAX_CHUNKS_PER_DOC);
    topSimilarity = merged.length > 0 ? Math.max(...merged.map((c) => c.similarity)) : 0;
  } else {
    const core = await hybridSearchCore(searchQuery, options);
    merged = core.chunks;
    topSimilarity = core.topSimilarity;
  }

  // ── Multi-hop: check if first pass is sufficient ──
  let multiHopQuery: string | undefined;
  if (env.RAG_MULTIHOP_ENABLED && merged.length > 0 && topSimilarity >= minSimilarity) {
    const followUp = await checkSufficiency(searchQuery, merged);
    if (followUp) {
      multiHopQuery = followUp;
      const extra = await hybridSearchCore(followUp, { ...options, topK: 3 });
      const combined = dedup([...merged, ...extra.chunks]);
      combined.sort((a, b) => b.score - a.score);
      merged = diversify(combined, topK, env.RAG_MAX_CHUNKS_PER_DOC);
      topSimilarity = Math.max(topSimilarity, extra.topSimilarity);
    }
  }

  // ── #5: Feedback logging (fire-and-forget) ──
  logQueryAsync(userQuery, searchQuery, merged, topSimilarity, topSimilarity >= minSimilarity, {
    decomposed: subQueries ?? undefined,
    multiHopQuery,
    reranked: env.RAG_RERANK_ENABLED,
  });

  return {
    chunks: merged,
    searchQuery,
    topSimilarity,
    confident: topSimilarity >= minSimilarity,
    decomposed: subQueries ?? undefined,
    multiHopQuery,
  };
}

// ─── #5: Feedback logging ────────────────────────────────────────────

function logQueryAsync(
  userQuery: string,
  searchQuery: string,
  chunks: RankedChunk[],
  topSimilarity: number,
  confident: boolean,
  meta: { decomposed?: string[]; multiHopQuery?: string; reranked: boolean },
): void {
  const chunkSummary = chunks.map((c) => ({
    id: c.id, fileId: c.fileId, score: c.score, similarity: c.similarity,
    docTitle: c.docTitle, heading: c.heading,
  }));

  dbQuery(
    `INSERT INTO rag_query_logs
      (user_query, search_query, chunks, top_similarity, confident, reranked, decomposed, multi_hop_query)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userQuery, searchQuery, JSON.stringify(chunkSummary),
      topSimilarity, confident, meta.reranked,
      meta.decomposed ? JSON.stringify(meta.decomposed) : null,
      meta.multiHopQuery ?? null,
    ],
  ).catch(() => {});
}

export async function submitFeedback(logId: string, feedback: number): Promise<void> {
  await dbQuery(
    `UPDATE rag_query_logs SET feedback = $2 WHERE id = $1`,
    [logId, feedback],
  );
}

export async function getAdaptiveThreshold(): Promise<number> {
  const result = await dbQuery<{ threshold: number }>(
    `SELECT percentile_cont(0.1) WITHIN GROUP (ORDER BY top_similarity) AS threshold
     FROM rag_query_logs
     WHERE feedback = 1 AND created_at > now() - interval '30 days'`,
  );
  return result.rows[0]?.threshold ?? env.RAG_MIN_SIMILARITY;
}
