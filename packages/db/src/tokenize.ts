// ---------------------------------------------------------------------------
// Tokenisation for keyword search (BM25 in hybridSearch)
// ---------------------------------------------------------------------------
//
// The default tokeniser uses the runtime's built-in `Intl.Segmenter` (ICU word
// segmentation), which segments CJK / Japanese / Thai by dictionary
// (机器学习 → 机器 / 学习) as well as space-delimited languages — no extra
// dependency. It is pluggable: call `setTokenizer` to swap in a dictionary
// segmenter such as jieba for higher-quality Chinese segmentation.

/** Maps text to an ordered list of lower-case terms (repeats kept). */
export type Tokenizer = (text: string) => string[];

// Keep any segment containing a letter or number; drop whitespace/punctuation.
// `Intl.Segmenter`'s `isWordLike` is unusable here — it reports `false` for
// numbers and alphanumerics ("2024", "gpt", "v2"), which we must keep.
const WORDY = /[\p{L}\p{N}]/u;

// Runs of non-(letter|number|underscore) — the word/part separator. Used to
// split intra-word punctuation out of a segment (config.yaml -> config/yaml)
// and as the whole-text tokeniser when `Intl.Segmenter` is unavailable.
const FALLBACK_SPLIT = /[^\p{L}\p{N}_]+/u;

const segmenter: Intl.Segmenter | null = (() => {
  try {
    return new Intl.Segmenter(undefined, { granularity: "word" });
  } catch {
    return null;
  }
})();

/**
 * Default tokeniser: Unicode word segmentation via `Intl.Segmenter`. Segments
 * CJK/Japanese/Thai with ICU dictionaries and splits space-delimited languages
 * on word boundaries; keeps numbers; lower-cases. Falls back to a Unicode regex
 * split when the runtime has no `Intl.Segmenter`.
 */
export const defaultTokenizer: Tokenizer = (text) => {
  const lower = text.toLowerCase();
  if (!segmenter) {
    return lower.split(FALLBACK_SPLIT).filter((t) => t.length > 0);
  }
  const out: string[] = [];
  for (const { segment } of segmenter.segment(lower)) {
    if (!WORDY.test(segment)) continue; // skip whitespace / punctuation segments
    // Intl.Segmenter keeps intra-word `.` / `'` (e.g. "config.yaml", "user's",
    // "3.14"); split those out so code, filenames, and versions stay searchable
    // by part. Underscore is kept (identifier-like), and CJK / word segments
    // have no such punctuation, so they pass through unchanged.
    for (const part of segment.split(FALLBACK_SPLIT)) {
      if (part.length > 0) out.push(part);
    }
  }
  return out;
};

let active: Tokenizer = defaultTokenizer;

/**
 * Override the tokeniser used by keyword search (`hybridSearch`) — e.g. to plug
 * in a dictionary segmenter like jieba for Chinese:
 *
 * ```ts
 * import { cut } from "@node-rs/jieba";
 * setTokenizer((text) => cut(text.toLowerCase(), true));
 * ```
 *
 * Call with no argument to restore the default `Intl.Segmenter` tokeniser.
 */
export function setTokenizer(tokenizer: Tokenizer = defaultTokenizer): void {
  active = tokenizer;
}

/**
 * Tokenise text with the active tokeniser (default: `Intl.Segmenter`). Empty
 * tokens are dropped here so a custom tokeniser that emits `""` (e.g. a naive
 * `split(" ")` on runs of whitespace) can't poison BM25 term counts, document
 * lengths, or let a blank query self-match.
 */
export function tokenize(text: string): string[] {
  return active(text).filter((t) => t.length > 0);
}
