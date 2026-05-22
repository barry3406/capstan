import { describe, it, expect } from "bun:test";
import {
  cosineDistance,
  findNearest,
  hybridSearch,
} from "@zauso-ai/capstan-db";
import type { VectorItem, HybridItem } from "@zauso-ai/capstan-db";

// ---------------------------------------------------------------------------
// cosineDistance
// ---------------------------------------------------------------------------

describe("cosineDistance", () => {
  it("returns 0 for identical vectors", () => {
    expect(cosineDistance([1, 2, 3], [1, 2, 3])).toBeCloseTo(0, 10);
  });

  it("returns 1 for orthogonal vectors", () => {
    // [1,0] and [0,1] are perpendicular; cosine similarity = 0, distance = 1
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1, 10);
  });

  it("returns 2 for opposite vectors", () => {
    // [1,0] and [-1,0] point in opposite directions
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2, 10);
  });

  it("known values: [1,0] vs [0,1] = 1.0", () => {
    expect(cosineDistance([1, 0], [0, 1])).toBe(1);
  });

  it("known values: [1,1] vs [1,1] = 0.0", () => {
    expect(cosineDistance([1, 1], [1, 1])).toBeCloseTo(0, 10);
  });

  it("known values: [1,0] vs [-1,0] = 2.0", () => {
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2, 10);
  });

  it("known values: [3,4] vs [4,3] — verifies math", () => {
    // dot = 3*4 + 4*3 = 24
    // |a| = sqrt(9+16) = 5, |b| = sqrt(16+9) = 5
    // similarity = 24/25 = 0.96
    // distance = 1 - 0.96 = 0.04
    const result = cosineDistance([3, 4], [4, 3]);
    expect(result).toBeCloseTo(1 - 24 / 25, 10);
    expect(result).toBeCloseTo(0.04, 10);
  });

  it("throws on different-length vectors", () => {
    expect(() => cosineDistance([1, 2], [1, 2, 3])).toThrow(
      "Vector length mismatch: 2 vs 3",
    );
  });

  it("returns 1 for a zero vector vs a non-zero vector", () => {
    // zero-vector edge case: denominator is 0 => returns 1
    expect(cosineDistance([0, 0, 0], [1, 2, 3])).toBe(1);
  });

  it("returns 1 for both zero vectors", () => {
    expect(cosineDistance([0, 0], [0, 0])).toBe(1);
  });

  it("returns 1 for empty vectors (zero-denominator guard)", () => {
    // Both vectors are empty — dot product and norms are all 0, denom is 0.
    // The zero-denom guard returns 1.
    expect(cosineDistance([], [])).toBe(1);
  });

  it("handles single-dimension vectors", () => {
    // [5] vs [3]: both positive, same direction => distance 0
    expect(cosineDistance([5], [3])).toBeCloseTo(0, 10);
    // [5] vs [-3]: opposite => distance 2
    expect(cosineDistance([5], [-3])).toBeCloseTo(2, 10);
  });

  it("handles high-dimension vectors (1536 dims)", () => {
    const a = new Array(1536).fill(0).map((_, i) => Math.sin(i));
    const b = [...a]; // identical copy
    expect(cosineDistance(a, b)).toBeCloseTo(0, 10);

    // sin(i) vs cos(i) — nearly orthogonal over 1536 dimensions.
    // Exact value: dot=~0.133, norms=~768 each, similarity=~0.000173,
    // distance=~0.9998.
    const c = new Array(1536).fill(0).map((_, i) => Math.cos(i));
    const dist = cosineDistance(a, c);
    expect(dist).toBeCloseTo(0.9998269802039688, 5);
  });

  it("handles negative component values", () => {
    // [-1,-1] vs [-1,-1] same direction => distance 0
    expect(cosineDistance([-1, -1], [-1, -1])).toBeCloseTo(0, 10);
    // [-1,0] vs [1,0] opposite => distance 2
    expect(cosineDistance([-1, 0], [1, 0])).toBeCloseTo(2, 10);
  });

  it("handles very small values near float precision", () => {
    const tiny = 1e-15;
    const a = [tiny, tiny];
    const b = [tiny, tiny];
    // Same direction, result should be close to 0
    expect(cosineDistance(a, b)).toBeCloseTo(0, 5);
  });

  it("handles very large values", () => {
    const big = 1e15;
    const a = [big, 0];
    const b = [0, big];
    // Orthogonal => distance 1
    expect(cosineDistance(a, b)).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// findNearest
// ---------------------------------------------------------------------------

describe("findNearest", () => {
  const items: VectorItem[] = [
    { id: "a", vector: [1, 0] },
    { id: "b", vector: [0, 1] },
    { id: "c", vector: [1, 1] },
    { id: "d", vector: [-1, 0] },
  ];

  it("returns top-k items sorted by similarity (descending)", () => {
    const query = [1, 0]; // most similar to "a", then "c"
    const results = findNearest(query, items, 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe("a");
    expect(results[1]!.id).toBe("c");
    // scores descending
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });

  it("k=1 returns single best match", () => {
    const results = findNearest([0, 1], items, 1);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("b");
  });

  it("k larger than items returns all items", () => {
    const results = findNearest([1, 0], items, 100);
    expect(results).toHaveLength(items.length);
  });

  it("k=0 returns empty array", () => {
    const results = findNearest([1, 0], items, 0);
    expect(results).toHaveLength(0);
  });

  it("empty items array returns empty", () => {
    const results = findNearest([1, 0], [], 5);
    expect(results).toHaveLength(0);
  });

  it("items with identical vectors produce stable ordering", () => {
    const dupes: VectorItem[] = [
      { id: "x", vector: [1, 0] },
      { id: "y", vector: [1, 0] },
      { id: "z", vector: [1, 0] },
    ];
    const results = findNearest([1, 0], dupes, 3);
    expect(results).toHaveLength(3);
    // All scores should be identical (1.0)
    for (const r of results) {
      expect(r.score).toBeCloseTo(1, 10);
    }
  });

  it("verifies score values are correct (1 - cosineDistance)", () => {
    // query [1,0] vs item [0,1]: cosineDistance = 1, score = 0
    // query [1,0] vs item [1,0]: cosineDistance = 0, score = 1
    const results = findNearest([1, 0], items, 4);
    const scoreA = results.find((r) => r.id === "a")!.score;
    const scoreB = results.find((r) => r.id === "b")!.score;
    const scoreD = results.find((r) => r.id === "d")!.score;

    expect(scoreA).toBeCloseTo(1, 10); // identical direction
    expect(scoreB).toBeCloseTo(0, 10); // orthogonal
    expect(scoreD).toBeCloseTo(-1, 10); // opposite direction
  });

  it("single item returns that item", () => {
    const single: VectorItem[] = [{ id: "only", vector: [3, 4] }];
    const results = findNearest([3, 4], single, 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("only");
    expect(results[0]!.score).toBeCloseTo(1, 10);
  });

  it("negative k returns items minus last |k| via Array.slice semantics", () => {
    // Array.prototype.slice(0, -2) returns all but the last 2 elements.
    // With 4 items sorted by score, slice(0, -2) returns the top 2.
    const results = findNearest([1, 0], items, -2);
    expect(results).toHaveLength(2);
    // The top 2 by similarity to [1,0] are "a" (score 1) and "c" (score ~0.707).
    expect(results[0]!.id).toBe("a");
    expect(results[1]!.id).toBe("c");
  });

  it("all items identical to query score 1.0", () => {
    const same: VectorItem[] = [
      { id: "p", vector: [2, 3] },
      { id: "q", vector: [2, 3] },
    ];
    const results = findNearest([2, 3], same, 2);
    for (const r of results) {
      expect(r.score).toBeCloseTo(1, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// hybridSearch
// ---------------------------------------------------------------------------

describe("hybridSearch", () => {
  const items: HybridItem[] = [
    { id: "doc1", text: "machine learning algorithms", vector: [1, 0, 0] },
    { id: "doc2", text: "deep learning neural networks", vector: [0, 1, 0] },
    { id: "doc3", text: "algorithms and data structures", vector: [0, 0, 1] },
    { id: "doc4", text: "machine learning frameworks", vector: [0.9, 0.1, 0] },
  ];

  it("combines keyword and vector scores", () => {
    // "machine" matches doc1, doc4 (keyword)
    // vector [1,0,0] is closest to doc1 then doc4
    const results = hybridSearch("machine", [1, 0, 0], items, { k: 4 });
    expect(results).toHaveLength(4);
    // doc1 should rank first: high keyword AND high vector
    expect(results[0]!.id).toBe("doc1");
  });

  it("uses default weights: keyword 0.3, vector 0.7", () => {
    // doc1: keyword for "machine" = 1/1 = 1.0, vector vs [1,0,0] = 1.0
    // combined = 0.3*1.0 + 0.7*1.0 = 1.0
    const results = hybridSearch("machine", [1, 0, 0], items, { k: 1 });
    expect(results[0]!.id).toBe("doc1");
    expect(results[0]!.score).toBeCloseTo(0.3 * 1 + 0.7 * 1, 5);
  });

  it("respects custom weights: keyword 0.5, vector 0.5", () => {
    const results = hybridSearch("machine", [1, 0, 0], items, {
      k: 4,
      keywordWeight: 0.5,
      vectorWeight: 0.5,
    });
    // doc1: kw = 1.0, vec = 1.0 => 0.5 + 0.5 = 1.0
    expect(results[0]!.score).toBeCloseTo(1.0, 5);
  });

  it("pure keyword search (vectorWeight: 0, keywordWeight: 1)", () => {
    // Only keyword matters. "algorithms" appears in doc1 (3 words) and doc3
    // (4 words); BM25 length-normalisation ranks the shorter doc1 above doc3.
    const results = hybridSearch("algorithms", [1, 0, 0], items, {
      k: 4,
      keywordWeight: 1,
      vectorWeight: 0,
    });
    const doc1 = results.find((r) => r.id === "doc1")!;
    const doc3 = results.find((r) => r.id === "doc3")!;
    const doc2 = results.find((r) => r.id === "doc2")!;
    expect(doc1.score).toBeCloseTo(1.0, 10); // top match -> normalised to 1.0
    expect(doc3.score).toBeGreaterThan(0);
    expect(doc1.score).toBeGreaterThan(doc3.score);
    expect(doc2.score).toBeCloseTo(0, 10); // no "algorithms"
  });

  it("pure vector search (keywordWeight: 0, vectorWeight: 1)", () => {
    const results = hybridSearch("machine", [0, 1, 0], items, {
      k: 4,
      keywordWeight: 0,
      vectorWeight: 1,
    });
    // doc2 vector [0,1,0] is identical to query
    expect(results[0]!.id).toBe("doc2");
    expect(results[0]!.score).toBeCloseTo(1.0, 10);
  });

  it("empty query string results in keyword score 0 for all items", () => {
    // Empty string tokenizes to [] => keyword score = 0 for all
    const results = hybridSearch("", [1, 0, 0], items, {
      k: 4,
      keywordWeight: 0.5,
      vectorWeight: 0.5,
    });
    // Only vector component contributes
    // doc1 is closest to [1,0,0]
    expect(results[0]!.id).toBe("doc1");
    // Score should be 0.5 * vectorScore + 0.5 * 0
    expect(results[0]!.score).toBeCloseTo(0.5 * 1.0, 5);
  });

  it("no keyword overlap results in keyword score 0, relies on vector", () => {
    // "quantum" doesn't appear in any document text
    const results = hybridSearch("quantum", [0, 1, 0], items, { k: 4 });
    // keyword score is 0 for all; ranking is purely by vector
    expect(results[0]!.id).toBe("doc2"); // closest to [0,1,0]
  });

  it("perfect keyword match gives keyword score 1.0", () => {
    // "machine" is a single-term query, appears in doc1 and doc4
    const results = hybridSearch("machine", [0, 0, 0], items, {
      k: 4,
      keywordWeight: 1,
      vectorWeight: 0,
    });
    // zero vector => vector component gives cosineDistance=1 => score 0,
    // but vectorWeight=0 so it doesn't matter
    const doc1 = results.find((r) => r.id === "doc1")!;
    expect(doc1.score).toBeCloseTo(1.0, 10);
  });

  it("more matching query terms rank higher (BM25 term coverage)", () => {
    // "machine learning": doc1 & doc4 match both terms; doc2 matches only
    // "learning"; doc3 matches neither. (Both query terms have similar IDF, so
    // coverage decides — unlike a rare term that can dominate on its own.)
    const results = hybridSearch("machine learning", [0, 0, 0], items, {
      k: 4,
      keywordWeight: 1,
      vectorWeight: 0,
    });
    const doc1 = results.find((r) => r.id === "doc1")!;
    const doc2 = results.find((r) => r.id === "doc2")!;
    const doc3 = results.find((r) => r.id === "doc3")!;
    expect(doc1.score).toBeGreaterThan(doc2.score); // 2 terms beats 1
    expect(doc2.score).toBeGreaterThan(0); // matches "learning"
    expect(doc3.score).toBeCloseTo(0, 10); // matches neither
  });

  it("case-insensitive keyword matching", () => {
    // "MACHINE" should match "machine" in doc1/doc4
    const results = hybridSearch("MACHINE", [0, 0, 0], items, {
      k: 4,
      keywordWeight: 1,
      vectorWeight: 0,
    });
    const doc1 = results.find((r) => r.id === "doc1")!;
    expect(doc1.score).toBeCloseTo(1.0, 10);
  });

  it("k parameter limits results", () => {
    const results = hybridSearch("learning", [1, 0, 0], items, { k: 2 });
    expect(results).toHaveLength(2);
  });

  it("k=0 returns empty array", () => {
    const results = hybridSearch("machine", [1, 0, 0], items, { k: 0 });
    expect(results).toHaveLength(0);
  });

  it("empty items array returns empty", () => {
    const results = hybridSearch("test", [1, 0], [], { k: 10 });
    expect(results).toHaveLength(0);
  });

  it("items with no text field content get keyword score 0", () => {
    const emptyTextItems: HybridItem[] = [
      { id: "e1", text: "", vector: [1, 0] },
      { id: "e2", text: "", vector: [0, 1] },
    ];
    const results = hybridSearch("test", [1, 0], emptyTextItems, {
      k: 2,
      keywordWeight: 0.5,
      vectorWeight: 0.5,
    });
    // keyword score 0 for both, ranking by vector only
    expect(results[0]!.id).toBe("e1"); // closer to [1,0]
    expect(results[0]!.score).toBeCloseTo(0.5 * 1.0, 5);
  });

  it("special characters in query are stripped by tokenizer", () => {
    // Punctuation like "!" and "?" should be stripped; only "machine" remains
    const results = hybridSearch("machine!!??", [0, 0, 0], items, {
      k: 4,
      keywordWeight: 1,
      vectorWeight: 0,
    });
    const doc1 = results.find((r) => r.id === "doc1")!;
    expect(doc1.score).toBeCloseTo(1.0, 10);
  });

  it("non-normalized weights allow scores to exceed 1.0", () => {
    // With keywordWeight=0.8 and vectorWeight=0.8, the combined score for
    // a perfect match on both axes is 0.8 * 1.0 + 0.8 * 1.0 = 1.6.
    const results = hybridSearch("machine", [1, 0, 0], items, {
      k: 4,
      keywordWeight: 0.8,
      vectorWeight: 0.8,
    });
    // doc1 has keyword score 1.0 ("machine" matches) and vector score 1.0
    // (identical to [1,0,0]), so combined = 0.8 + 0.8 = 1.6.
    const doc1 = results.find((r) => r.id === "doc1")!;
    expect(doc1.score).toBeCloseTo(1.6, 5);
    expect(doc1.score).toBeGreaterThan(1.0);
  });

  it("handles unicode text", () => {
    const unicodeItems: HybridItem[] = [
      { id: "u1", text: "apprentissage automatique", vector: [1, 0] },
      { id: "u2", text: "red neuronal profunda", vector: [0, 1] },
    ];
    const results = hybridSearch("automatique", [1, 0], unicodeItems, {
      k: 2,
      keywordWeight: 1,
      vectorWeight: 0,
    });
    // "automatique" matches u1
    expect(results[0]!.id).toBe("u1");
    expect(results[0]!.score).toBeCloseTo(1.0, 10);
  });

  it("segments CJK so a query matches by shared word", () => {
    const items: HybridItem[] = [
      { id: "c1", text: "机器学习很有趣", vector: [1, 0] },
      { id: "c2", text: "今天天气不错", vector: [0, 1] },
    ];
    // "机器学习" segments to 机器/学习 (ICU); c1 shares both words, c2 none.
    const results = hybridSearch("机器学习", [1, 0], items, {
      k: 2,
      keywordWeight: 1,
      vectorWeight: 0,
    });
    expect(results[0]!.id).toBe("c1");
    expect(results[0]!.score).toBeCloseTo(1.0, 10);
    expect(results.find((r) => r.id === "c2")!.score).toBeCloseTo(0, 10);
  });

  it("splits dotted identifiers so a query for a part matches", () => {
    const items: HybridItem[] = [
      { id: "f1", text: "see config.yaml for settings", vector: [1, 0] },
      { id: "f2", text: "nothing relevant here", vector: [0, 1] },
    ];
    // "config.yaml" -> config / yaml, so a "config" query matches f1.
    const results = hybridSearch("config", [1, 0], items, {
      k: 2,
      keywordWeight: 1,
      vectorWeight: 0,
    });
    expect(results[0]!.id).toBe("f1");
    expect(results[0]!.score).toBeCloseTo(1.0, 10);
    expect(results.find((r) => r.id === "f2")!.score).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------
// hybridSearch — BM25 keyword properties
// ---------------------------------------------------------------------------

describe("hybridSearch — BM25 keyword properties", () => {
  const kwOnly = { k: 10, keywordWeight: 1, vectorWeight: 0 };

  it("term-frequency saturation: more occurrences score higher, sub-linearly", () => {
    // Equal-length docs (4 tokens) so length-normalisation is identical;
    // only tf("x") varies: 1, 2, 3.
    const docs: HybridItem[] = [
      { id: "tf1", text: "x f1 f2 f3", vector: [1, 0] },
      { id: "tf2", text: "x x f4 f5", vector: [1, 0] },
      { id: "tf3", text: "x x x f6", vector: [1, 0] },
    ];
    const r = hybridSearch("x", [1, 0], docs, kwOnly);
    const s = (id: string) => r.find((x) => x.id === id)!.score;
    // monotonic increasing in tf
    expect(s("tf3")).toBeGreaterThan(s("tf2"));
    expect(s("tf2")).toBeGreaterThan(s("tf1"));
    // but saturating: each extra occurrence adds less than the previous
    expect(s("tf2") - s("tf1")).toBeGreaterThan(s("tf3") - s("tf2"));
  });

  it("IDF: a rare query term outweighs a common one", () => {
    // "common" is in 3/4 docs, "rare" in 1/4; same tf and length per doc.
    const docs: HybridItem[] = [
      { id: "rare", text: "rare aa bb", vector: [1, 0] },
      { id: "c1", text: "common cc dd", vector: [1, 0] },
      { id: "c2", text: "common ee ff", vector: [1, 0] },
      { id: "c3", text: "common gg hh", vector: [1, 0] },
    ];
    const r = hybridSearch("rare common", [1, 0], docs, kwOnly);
    const rare = r.find((x) => x.id === "rare")!.score;
    const common = r.find((x) => x.id === "c1")!.score;
    expect(rare).toBeGreaterThan(common); // rarer term carries more weight
    expect(common).toBeGreaterThan(0);
  });

  it("b controls document-length normalisation (b=0 disables it)", () => {
    const docs: HybridItem[] = [
      { id: "short", text: "term aa", vector: [1, 0] },
      { id: "long", text: "term bb cc dd ee", vector: [1, 0] },
    ];
    // Default b=0.75: the shorter doc is favoured for the same single match.
    const def = hybridSearch("term", [1, 0], docs, kwOnly);
    expect(def.find((x) => x.id === "short")!.score).toBeGreaterThan(
      def.find((x) => x.id === "long")!.score,
    );
    // b=0: length is ignored, so same tf/IDF => equal scores.
    const b0 = hybridSearch("term", [1, 0], docs, { ...kwOnly, bm25: { b: 0 } });
    expect(b0.find((x) => x.id === "short")!.score).toBeCloseTo(
      b0.find((x) => x.id === "long")!.score,
      10,
    );
  });
});
