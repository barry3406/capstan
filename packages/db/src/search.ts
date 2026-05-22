import { tokenize } from "./tokenize.js";

// ---------------------------------------------------------------------------
// Vector similarity search utilities
// ---------------------------------------------------------------------------

/**
 * Compute the cosine distance between two vectors.
 *
 * Returns a value in [0, 2] where 0 means identical direction and 2 means
 * opposite direction.  Cosine *similarity* = 1 - cosineDistance.
 */
export function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector length mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1; // zero-vector edge case

  const similarity = dot / denom;
  return 1 - similarity;
}

// ---------------------------------------------------------------------------
// k-NN search
// ---------------------------------------------------------------------------

export interface VectorItem {
  id: string;
  vector: number[];
}

export interface ScoredResult {
  id: string;
  score: number;
}

/**
 * Find the top-K nearest neighbours from an array of vectors using cosine
 * similarity (higher score = more similar).
 *
 * This is a brute-force scan suitable for small-to-medium datasets that fit
 * in memory.  For larger workloads, use a dedicated vector index (pgvector,
 * Qdrant, etc.).
 *
 * @returns Items sorted by descending similarity score.
 */
export function findNearest(
  query: number[],
  items: VectorItem[],
  k: number,
): ScoredResult[] {
  const scored: ScoredResult[] = items.map((item) => ({
    id: item.id,
    score: 1 - cosineDistance(query, item.vector),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ---------------------------------------------------------------------------
// Hybrid search (keyword + vector)
// ---------------------------------------------------------------------------

export interface HybridItem {
  id: string;
  text: string;
  vector: number[];
}

export interface HybridSearchOptions {
  /** Number of results to return. @default 10 */
  k?: number;
  /** Weight for the keyword component (0-1). @default 0.3 */
  keywordWeight?: number;
  /** Weight for the vector component (0-1). @default 0.7 */
  vectorWeight?: number;
  /** BM25 tuning: `k1` term-frequency saturation (@default 1.5) and `b`
   * document-length normalisation, 0-1 (@default 0.75). */
  bm25?: { k1?: number; b?: number };
}

/**
 * Hybrid search combining **Okapi BM25** keyword relevance with vector cosine
 * similarity.
 *
 * The keyword component is BM25 computed over the candidate `items` (which
 * supply the corpus statistics — IDF and average document length): term-
 * frequency saturation (`k1`), document-length normalisation (`b`), and
 * probabilistic IDF. BM25 scores are normalised to [0, 1] by the top score in
 * the candidate set, so the keyword component fuses cleanly with the cosine
 * score via the weights.
 *
 * This in-memory scorer is for re-ranking a pre-filtered candidate set; for a
 * large corpus, back it with a dedicated full-text index.
 *
 * @returns Items sorted by descending combined score.
 */
export function hybridSearch(
  query: string,
  queryVector: number[],
  items: HybridItem[],
  opts?: HybridSearchOptions,
): ScoredResult[] {
  const k = opts?.k ?? 10;
  const keywordWeight = opts?.keywordWeight ?? 0.3;
  const vectorWeight = opts?.vectorWeight ?? 0.7;
  // Clamp to valid BM25 ranges so an out-of-range option can't make the
  // length-normalisation term negative (which would yield negative scores).
  const k1 = Math.max(0, opts?.bm25?.k1 ?? 1.5);
  const b = Math.min(1, Math.max(0, opts?.bm25?.b ?? 0.75));

  // Tokenise the query into unique terms (via the active tokeniser).
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 && queryVector.length === 0) {
    return [];
  }

  // BM25 keyword scores for the whole candidate set (normalised to [0, 1]).
  const keywordScores =
    queryTerms.length > 0 ? bm25Scores(queryTerms, items, k1, b) : null;

  const scored: ScoredResult[] = items.map((item, i) => {
    const vectorScore =
      queryVector.length > 0
        ? 1 - cosineDistance(queryVector, item.vector)
        : 0;
    const keywordScore = keywordScores ? keywordScores[i]! : 0;

    return {
      id: item.id,
      score: vectorWeight * vectorScore + keywordWeight * keywordScore,
    };
  });

  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, k);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Term-frequency map for a document (keeps counts), via the active tokeniser. */
function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/**
 * Okapi BM25 keyword scores for each item, normalised to [0, 1] by the highest
 * score in the set (the best keyword match becomes 1.0, so the component fuses
 * cleanly with cosine similarity). Corpus statistics (IDF, avgdl) are derived
 * from `items`. Returns one score per item, in input order.
 *
 *   score(D) = Σ_term  IDF(term) · tf·(k1+1) / ( tf + k1·(1 − b + b·|D|/avgdl) )
 */
function bm25Scores(
  queryTerms: string[],
  items: HybridItem[],
  k1: number,
  b: number,
): number[] {
  const N = items.length;
  if (N === 0) return [];

  const docCounts: Map<string, number>[] = new Array(N);
  const docLen: number[] = new Array(N);
  const df = new Map<string, number>(); // document frequency per term
  let totalLen = 0;

  for (let i = 0; i < N; i++) {
    const counts = termCounts(items[i]!.text);
    docCounts[i] = counts;
    let len = 0;
    for (const c of counts.values()) len += c;
    docLen[i] = len;
    totalLen += len;
    for (const term of counts.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const avgdl = totalLen / N || 1;

  // Probabilistic IDF, Lucene-style (always >= 0), per query term.
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const n = df.get(term) ?? 0;
    idf.set(term, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  const raw: number[] = new Array(N);
  let max = 0;
  for (let i = 0; i < N; i++) {
    const counts = docCounts[i]!;
    const lenNorm = 1 - b + b * (docLen[i]! / avgdl);
    let s = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      s += (idf.get(term) ?? 0) * ((tf * (k1 + 1)) / (tf + k1 * lenNorm));
    }
    raw[i] = s;
    if (s > max) max = s;
  }

  if (max === 0) return raw; // no query term matched any document
  return raw.map((s) => s / max);
}
