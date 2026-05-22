import { describe, it, expect } from "bun:test";
import { bm25Scores, bm25QueryTerms } from "../../packages/ai/src/bm25.ts";

describe("bm25QueryTerms", () => {
  it("lower-cases, splits on non-word chars, and de-duplicates", () => {
    expect(bm25QueryTerms("Machine, MACHINE learning!")).toEqual([
      "machine",
      "learning",
    ]);
  });
  it("returns [] for empty / punctuation-only input", () => {
    expect(bm25QueryTerms("")).toEqual([]);
    expect(bm25QueryTerms("  !!! ??? ")).toEqual([]);
  });
  it("keeps Unicode letters (accented, CJK) and underscores as tokens", () => {
    // ASCII \W would corrupt "café"->"caf" and drop CJK entirely.
    expect(bm25QueryTerms("Café_crème 机器学习, NAÏVE")).toEqual([
      "café_crème",
      "机器学习",
      "naïve",
    ]);
  });
});

describe("bm25Scores", () => {
  it("empty corpus returns an empty array", () => {
    expect(bm25Scores(["x"], [])).toEqual([]);
  });

  it("no matching term scores all zeros", () => {
    expect(bm25Scores(["zzz"], ["alpha beta", "gamma delta"])).toEqual([0, 0]);
  });

  it("normalises so the best match is 1.0", () => {
    const s = bm25Scores(["alpha"], ["alpha beta", "gamma delta"]);
    expect(Math.max(...s)).toBeCloseTo(1, 10);
    expect(s[1]).toBeCloseTo(0, 10); // no "alpha"
  });

  it("term-frequency saturation: increasing but sub-linear", () => {
    // Equal-length docs (4 tokens); only tf(x) differs: 1, 2, 3.
    const s = bm25Scores(["x"], ["x a b c", "x x d e", "x x x f"]);
    expect(s[2]).toBeGreaterThan(s[1]!);
    expect(s[1]).toBeGreaterThan(s[0]!);
    expect(s[1]! - s[0]!).toBeGreaterThan(s[2]! - s[1]!); // saturating
  });

  it("IDF: a rare term outweighs a common one (same tf/length)", () => {
    const docs = ["rare aa bb", "common cc dd", "common ee ff", "common gg hh"];
    const s = bm25Scores(["rare", "common"], docs);
    expect(s[0]).toBeGreaterThan(s[1]!); // rare doc beats a common-term doc
    expect(s[1]).toBeGreaterThan(0);
  });

  it("document-length normalisation: shorter doc wins for the same match", () => {
    const s = bm25Scores(["term"], ["term aa", "term bb cc dd ee"]);
    expect(s[0]).toBeGreaterThan(s[1]!);
  });

  it("b=0 disables length normalisation (equal tf/IDF => equal scores)", () => {
    const s = bm25Scores(["term"], ["term aa", "term bb cc dd ee"], { b: 0 });
    expect(s[0]).toBeCloseTo(s[1]!, 10);
  });

  it("clamps an out-of-range b so scores never go negative", () => {
    // b > 1 would make (1 - b + b·|D|/avgdl) negative for short docs and yield
    // negative scores; clamping to [0,1] keeps every score in [0,1].
    const s = bm25Scores(["term"], ["term aa", "term bb cc dd ee"], { b: 5 });
    for (const x of s) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
    // clamped to b=1, so it equals the b=1 result
    const at1 = bm25Scores(["term"], ["term aa", "term bb cc dd ee"], { b: 1 });
    expect(s[0]).toBeCloseTo(at1[0]!, 10);
    expect(s[1]).toBeCloseTo(at1[1]!, 10);
  });

  it("IDF dominance: a single rare term can outrank a doc matching more common terms", () => {
    // "machine"/"learning" appear in 5 of 6 docs (common, low IDF); "data" in
    // 1 (rare, high IDF). doc matching only "data" beats one matching both
    // common terms — BM25 does NOT guarantee "more matching terms ranks higher".
    const docs = [
      "machine learning a",
      "machine learning b",
      "machine learning c",
      "machine learning d",
      "machine learning e",
      "data f g",
    ];
    const s = bm25Scores(["machine", "learning", "data"], docs);
    expect(s[5]).toBeGreaterThan(s[0]!); // rare "data" doc > common "machine learning" doc
  });

  it("matches CJK / accented terms that ASCII \\W tokenisation would drop", () => {
    const cjk = bm25Scores(["机器学习"], ["机器学习 笔记", "english only"]);
    expect(cjk[0]).toBeGreaterThan(0); // CJK doc matched (was dropped under \W)
    expect(cjk[1]).toBeCloseTo(0, 10);

    const acc = bm25Scores(["café"], ["le café est bon", "tea house"]);
    expect(acc[0]).toBeGreaterThan(0);
    expect(acc[1]).toBeCloseTo(0, 10);
  });
});
