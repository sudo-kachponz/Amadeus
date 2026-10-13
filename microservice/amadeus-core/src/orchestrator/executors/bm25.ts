/**
 * Pure-TypeScript BM25 index for hybrid RAG retrieval.
 * Port of mandiri-click-ai-assistant/bm25.py — no sklearn/scipy,
 * uses Maps for sparse term-frequency storage.
 */

import { query } from '../../db/pool.js';

const TOKEN_RE = /[a-z0-9]+(?:[.''][a-z0-9]+)*/g;

const STOPWORDS = new Set(`
yang dan di ke dari untuk dengan pada adalah ini itu atau dalam apa apakah bagaimana berapa saya kami kita anda
bisa dapat ada tidak jika bila akan sudah oleh sebagai juga serta mohon tolong maka telah harus wajib setiap
tersebut sesuai lebih antara para kepada terhadap secara masing hal agar karena namun yaitu yakni
`.trim().split(/\s+/));

function tokenize(text: string): string[] {
  return [...text.toLowerCase().matchAll(TOKEN_RE)]
    .map((m) => m[0])
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface BM25Result {
  index: number;
  score: number;
}

export class BM25Index {
  private tf: Map<number, Map<string, number>>; // doc → term → count
  private df: Map<string, number>;              // term → doc count
  private docLengths: number[];
  private avgDl: number;
  private n: number;

  constructor(
    private readonly k1 = 1.5,
    private readonly b = 0.75,
  ) {
    this.tf = new Map();
    this.df = new Map();
    this.docLengths = [];
    this.avgDl = 0;
    this.n = 0;
  }

  build(documents: string[]): void {
    this.tf = new Map();
    this.df = new Map();
    this.docLengths = [];
    this.n = documents.length;

    let totalLength = 0;
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!;
      const tokens = tokenize(doc);
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;

      const termCounts = new Map<string, number>();
      const seen = new Set<string>();
      for (const t of tokens) {
        termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
        if (!seen.has(t)) {
          seen.add(t);
          this.df.set(t, (this.df.get(t) ?? 0) + 1);
        }
      }
      this.tf.set(i, termCounts);
    }
    this.avgDl = this.n > 0 ? totalLength / this.n : 1;
  }

  search(queryText: string, topN: number): BM25Result[] {
    const terms = tokenize(queryText);
    if (terms.length === 0 || this.n === 0) return [];

    const scores: number[] = new Array<number>(this.n).fill(0);
    for (const term of terms) {
      const docFreq = this.df.get(term);
      if (!docFreq) continue;
      const idf = Math.log1p((this.n - docFreq + 0.5) / (docFreq + 0.5));

      for (let i = 0; i < this.n; i++) {
        const tf = this.tf.get(i)?.get(term) ?? 0;
        if (tf === 0) continue;
        const dl = this.docLengths[i] ?? 0;
        const norm = this.k1 * (1 - this.b + this.b * dl / this.avgDl);
        scores[i]! += idf * (tf * (this.k1 + 1)) / (tf + norm);
      }
    }

    const results: BM25Result[] = [];
    for (let i = 0; i < this.n; i++) {
      if (scores[i]! > 0) results.push({ index: i, score: scores[i]! });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topN);
  }
}

// ─── Module singleton ────────────────────────────────────────────────

let _index: BM25Index | null = null;
let _docIds: string[] = []; // maps BM25 index position → rag_documents.id

export async function initBm25Index(): Promise<void> {
  const result = await query<{ id: string; content: string }>(
    `SELECT id, content FROM rag_documents ORDER BY id`,
  );
  _docIds = result.rows.map((r) => r.id);
  _index = new BM25Index();
  _index.build(result.rows.map((r) => r.content));
}

// ponytail: full rebuild from DB after every mutation. Fine for <50k chunks.
// Switch to incremental add/remove if startup latency matters.
export const rebuildBm25Index = initBm25Index;

export function bm25Search(queryText: string, topN: number): { docId: string; score: number }[] {
  if (!_index) return [];
  return _index.search(queryText, topN)
    .filter((r) => _docIds[r.index] != null)
    .map((r) => ({
      docId: _docIds[r.index]!,
      score: r.score,
    }));
}
