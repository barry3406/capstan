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
}

/**
 * Hybrid search combining BM25-style keyword matching with vector cosine
 * similarity.
 *
 * The keyword score is a simple normalised term-frequency overlap (not a
 * full BM25 implementation) which is sufficient for re-ranking a
 * pre-filtered candidate set.  For production-grade keyword search, pair
 * with a proper full-text index.
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

  // Tokenise the query into lower-case terms.
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 && queryVector.length === 0) {
    return [];
  }

  // Score each item.
  const scored: ScoredResult[] = items.map((item) => {
    const vectorScore =
      queryVector.length > 0
        ? 1 - cosineDistance(queryVector, item.vector)
        : 0;

    const keywordScore =
      queryTerms.length > 0 ? keywordOverlap(queryTerms, item.text) : 0;

    return {
      id: item.id,
      score: vectorWeight * vectorScore + keywordWeight * keywordScore,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Simple whitespace tokeniser with lower-casing and deduplication. */
function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 0),
    ),
  ];
}

/**
 * Normalised keyword overlap score in [0, 1].
 *
 * Counts how many query terms appear in the document text, divided by the
 * number of query terms.
 */
function keywordOverlap(queryTerms: string[], text: string): number {
  const docTokens = new Set(tokenize(text));
  let hits = 0;
  for (const term of queryTerms) {
    if (docTokens.has(term)) {
      hits++;
    }
  }
  return hits / queryTerms.length;
}
