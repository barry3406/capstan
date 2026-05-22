import { tokenize } from "./tokenize.js";

// ---------------------------------------------------------------------------
// Okapi BM25 keyword relevance
// ---------------------------------------------------------------------------
//
// Bag-of-words ranking with term-frequency saturation (k1), document-length
// normalisation (b), and probabilistic IDF. Scores are computed over the
// supplied candidate set (which provides the corpus statistics — IDF and
// average document length) and normalised to [0, 1] by the top score, so the
// keyword component fuses cleanly with a cosine-similarity component.

/** Term-frequency map for a document (keeps counts), via the active tokeniser. */
function termCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/** Tokenise a query into unique terms (via the active tokeniser). */
export function bm25QueryTerms(text: string): string[] {
  return [...new Set(tokenize(text))];
}

/**
 * Okapi BM25 keyword scores for each document in `docs`, normalised to [0, 1]
 * by the highest score (the best keyword match becomes 1.0; `0` means no query
 * term is present). Returns one score per document, in input order.
 *
 *   score(D) = Σ_term  IDF(term) · tf·(k1+1) / ( tf + k1·(1 − b + b·|D|/avgdl) )
 *
 * IDF is the Lucene-style probabilistic form `log(1 + (N − n + 0.5)/(n + 0.5))`
 * (always ≥ 0). Corpus statistics (N, document frequency, average length) are
 * derived from `docs`.
 */
export function bm25Scores(
  queryTerms: string[],
  docs: string[],
  opts?: { k1?: number; b?: number },
): number[] {
  const N = docs.length;
  if (N === 0) return [];
  // Clamp to valid BM25 ranges: an out-of-range `b` would make the length-norm
  // term `(1 − b + b·|D|/avgdl)` negative for short docs, yielding negative
  // scores that break the [0,1] normalisation and the downstream `> 0` filter.
  const k1 = Math.max(0, opts?.k1 ?? 1.5);
  const b = Math.min(1, Math.max(0, opts?.b ?? 0.75));

  const docCounts = docs.map(termCounts);
  const docLen = docCounts.map((c) => {
    let n = 0;
    for (const v of c.values()) n += v;
    return n;
  });
  const avgdl = docLen.reduce((a, len) => a + len, 0) / N || 1;

  const df = new Map<string, number>();
  for (const counts of docCounts) {
    for (const term of counts.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const n = df.get(term) ?? 0;
    idf.set(term, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  const raw = docCounts.map((counts, i) => {
    const lenNorm = 1 - b + b * (docLen[i]! / avgdl);
    let s = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      s += (idf.get(term) ?? 0) * ((tf * (k1 + 1)) / (tf + k1 * lenNorm));
    }
    return s;
  });

  let max = 0;
  for (const s of raw) if (s > max) max = s;
  return max === 0 ? raw : raw.map((s) => s / max);
}
