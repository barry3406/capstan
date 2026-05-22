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
});
