import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { bm25Scores, bm25QueryTerms } from "../../packages/ai/src/bm25.ts";
import { setTokenizer } from "../../packages/ai/src/tokenize.ts";

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
  it("segments CJK by word, keeps accented letters / underscores / numbers", () => {
    // Intl.Segmenter splits CJK into words (机器学习 -> 机器/学习) via ICU and
    // keeps numbers; ASCII \W would corrupt "café"->"caf" and drop CJK entirely.
    expect(bm25QueryTerms("Café_crème 机器学习, NAÏVE")).toEqual([
      "café_crème",
      "机器",
      "学习",
      "naïve",
    ]);
    expect(bm25QueryTerms("GPT-4 发布于 2024 年")).toEqual([
      "gpt",
      "4",
      "发布",
      "于",
      "2024",
      "年",
    ]);
  });

  it("splits code identifiers / filenames / versions on intra-word punctuation", () => {
    // Intl.Segmenter keeps "config.yaml" / "3.14" / "user's" whole; we split the
    // parts out so they stay searchable. Underscores are kept (identifier-like).
    expect(bm25QueryTerms("config.yaml node.js v2.0 user's")).toEqual([
      "config", "yaml", "node", "js", "v2", "0", "user", "s",
    ]);
    expect(bm25QueryTerms("snake_case_var")).toEqual(["snake_case_var"]);
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

  it("CJK word segmentation enables sub-phrase matching", () => {
    // Docs have no spaces; segmentation lets the query share individual words.
    const docs = ["机器学习很有趣", "深度学习入门", "今天天气不错"];
    const s = bm25Scores(bm25QueryTerms("机器学习"), docs); // query -> ["机器","学习"]
    expect(s[0]).toBeGreaterThan(0); // shares 机器 + 学习
    expect(s[1]).toBeGreaterThan(0); // shares 学习
    expect(s[2]).toBeCloseTo(0, 10); // no shared word
    expect(s[0]).toBeGreaterThan(s[1]!); // doc0 shares two words, doc1 one

    const acc = bm25Scores(bm25QueryTerms("café"), ["le café est bon", "tea house"]);
    expect(acc[0]).toBeGreaterThan(0);
    expect(acc[1]).toBeCloseTo(0, 10);
  });

  it("a query for an identifier part matches a doc with the whole identifier", () => {
    const s = bm25Scores(bm25QueryTerms("config"), [
      "edit config.yaml now",
      "unrelated text",
    ]);
    expect(s[0]).toBeGreaterThan(0); // "config" matches the split "config.yaml"
    expect(s[1]).toBeCloseTo(0, 10);
  });
});

describe("pluggable tokenizer", () => {
  beforeEach(() => setTokenizer()); // start from the default
  afterEach(() => setTokenizer()); // and restore it (no leak to other test files)

  it("setTokenizer swaps the tokeniser used by bm25QueryTerms", () => {
    setTokenizer((t) => t.toLowerCase().split("/").filter(Boolean));
    expect(bm25QueryTerms("a/b/b/c")).toEqual(["a", "b", "c"]);
  });

  it("setTokenizer() with no argument restores the Intl.Segmenter default", () => {
    setTokenizer((t) => [t]); // whole-string tokeniser
    setTokenizer(); // reset
    expect(bm25QueryTerms("机器学习")).toEqual(["机器", "学习"]);
  });

  it("drops empty tokens from a custom tokeniser (no BM25 poisoning)", () => {
    // A naive whitespace split emits "" on leading/trailing/double spaces.
    setTokenizer((t) => t.toLowerCase().split(" "));
    expect(bm25QueryTerms("  alpha   beta ")).toEqual(["alpha", "beta"]);
    // A space-only query has no usable terms => matches nothing (no "" term).
    expect(
      bm25Scores(bm25QueryTerms("   "), ["alpha  beta", "gamma"]),
    ).toEqual([0, 0]);
  });
});
