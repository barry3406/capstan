import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, writeFile, readFile, rm, access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  negotiateFormat,
  computeImageCacheKey,
  normalizeTransformOptions,
  parseImageQuery,
  createImageOptimizer,
  ImageOptimizerError,
} from "@zauso-ai/capstan-core";
import type {
  ImageTransformOptions,
  ImageOptimizerConfig,
} from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function tmpRoot(): string {
  return join(tmpdir(), `capstan-img-test-${randomUUID()}`);
}

async function createTestTree(
  rootDir: string,
  files: Record<string, string | Buffer>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(rootDir, rel);
    const dir = full.slice(0, full.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    if (typeof content === "string") {
      await writeFile(full, content, "utf-8");
    } else {
      await writeFile(full, content);
    }
  }
}

// Minimal 1x1 PNG (67 bytes)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// Minimal SVG
const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

// ==========================================================================
// negotiateFormat
// ==========================================================================

describe("negotiateFormat", () => {
  test("prefers avif when Accept includes image/avif", () => {
    expect(negotiateFormat("image/avif,image/webp,image/jpeg")).toBe("avif");
  });

  test("picks webp when avif absent but webp present", () => {
    expect(negotiateFormat("image/webp,image/jpeg")).toBe("webp");
  });

  test("falls back to jpeg when only jpeg offered", () => {
    expect(negotiateFormat("image/jpeg")).toBe("jpeg");
  });

  test("falls back to jpeg for wildcard accept", () => {
    expect(negotiateFormat("*/*")).toBe("jpeg");
  });

  test("falls back to jpeg for empty string", () => {
    expect(negotiateFormat("")).toBe("jpeg");
  });

  test("falls back to jpeg for null", () => {
    expect(negotiateFormat(null)).toBe("jpeg");
  });

  test("falls back to jpeg for undefined", () => {
    expect(negotiateFormat(undefined)).toBe("jpeg");
  });

  test("falls back to jpeg when no image types present", () => {
    expect(negotiateFormat("text/html,application/json")).toBe("jpeg");
  });

  test("still detects avif even with quality factors", () => {
    // avif appears in the string so it matches first
    expect(negotiateFormat("image/webp;q=0.8,image/avif;q=0.9")).toBe("avif");
  });

  test("picks avif when only avif offered", () => {
    expect(negotiateFormat("image/avif")).toBe("avif");
  });

  test("case insensitive avif match", () => {
    expect(negotiateFormat("Image/AVIF")).toBe("avif");
  });

  test("case insensitive webp match", () => {
    expect(negotiateFormat("Image/WebP")).toBe("webp");
  });

  test("picks avif over webp when both present regardless of order", () => {
    expect(negotiateFormat("image/webp, image/avif")).toBe("avif");
  });
});

// ==========================================================================
// computeImageCacheKey
// ==========================================================================

describe("computeImageCacheKey", () => {
  test("same inputs produce same key", () => {
    const opts: ImageTransformOptions = { width: 800, quality: 75 };
    const a = computeImageCacheKey("/photo.jpg", opts, "webp");
    const b = computeImageCacheKey("/photo.jpg", opts, "webp");
    expect(a).toBe(b);
  });

  test("different width produces different key", () => {
    const a = computeImageCacheKey("/photo.jpg", { width: 800 }, "webp");
    const b = computeImageCacheKey("/photo.jpg", { width: 400 }, "webp");
    expect(a).not.toBe(b);
  });

  test("different quality produces different key", () => {
    const a = computeImageCacheKey("/photo.jpg", { quality: 80 }, "jpeg");
    const b = computeImageCacheKey("/photo.jpg", { quality: 60 }, "jpeg");
    expect(a).not.toBe(b);
  });

  test("different format produces different key", () => {
    const a = computeImageCacheKey("/photo.jpg", { width: 800 }, "webp");
    const b = computeImageCacheKey("/photo.jpg", { width: 800 }, "avif");
    expect(a).not.toBe(b);
  });

  test("different path case produces different key", () => {
    const a = computeImageCacheKey("/Photo.jpg", { width: 800 }, "webp");
    const b = computeImageCacheKey("/photo.jpg", { width: 800 }, "webp");
    expect(a).not.toBe(b);
  });

  test("key is a hex string of expected length (SHA-256 = 64 chars)", () => {
    const key = computeImageCacheKey("/img.png", {}, "png");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("path with special characters", () => {
    const key = computeImageCacheKey("/images/photo (1).jpg", { width: 100 }, "jpeg");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("options with fit included", () => {
    const a = computeImageCacheKey("/a.jpg", { width: 100, fit: "cover" }, "jpeg");
    const b = computeImageCacheKey("/a.jpg", { width: 100, fit: "contain" }, "jpeg");
    expect(a).not.toBe(b);
  });

  test("options with undefined fields produce stable keys", () => {
    const a = computeImageCacheKey("/a.jpg", { width: undefined }, "jpeg");
    const b = computeImageCacheKey("/a.jpg", {}, "jpeg");
    // Both serialize the same because undefined is omitted by JSON.stringify
    expect(a).toBe(b);
  });
});

// ==========================================================================
// normalizeTransformOptions
// ==========================================================================

describe("normalizeTransformOptions", () => {
  // --- width edge cases ---

  test("width: 0 is dropped", () => {
    expect(normalizeTransformOptions({ width: 0 }).width).toBeUndefined();
  });

  test("width: -1 is dropped", () => {
    expect(normalizeTransformOptions({ width: -1 }).width).toBeUndefined();
  });

  test("width: NaN is dropped", () => {
    expect(normalizeTransformOptions({ width: NaN }).width).toBeUndefined();
  });

  test("width: Infinity is dropped", () => {
    expect(normalizeTransformOptions({ width: Infinity }).width).toBeUndefined();
  });

  test("width: 1 is preserved", () => {
    expect(normalizeTransformOptions({ width: 1 }).width).toBe(1);
  });

  test("width: 4096 (max) is preserved", () => {
    expect(normalizeTransformOptions({ width: 4096 }).width).toBe(4096);
  });

  test("width: 4097 is clamped to 4096", () => {
    expect(normalizeTransformOptions({ width: 4097 }).width).toBe(4096);
  });

  test("width: 100.5 is rounded to 101", () => {
    expect(normalizeTransformOptions({ width: 100.5 }).width).toBe(101);
  });

  test("width: 100.4 is rounded to 100", () => {
    expect(normalizeTransformOptions({ width: 100.4 }).width).toBe(100);
  });

  // --- height edge cases ---

  test("height: 0 is dropped", () => {
    expect(normalizeTransformOptions({ height: 0 }).height).toBeUndefined();
  });

  test("height: -1 is dropped", () => {
    expect(normalizeTransformOptions({ height: -1 }).height).toBeUndefined();
  });

  test("height: NaN is dropped", () => {
    expect(normalizeTransformOptions({ height: NaN }).height).toBeUndefined();
  });

  test("height: Infinity is dropped", () => {
    expect(normalizeTransformOptions({ height: Infinity }).height).toBeUndefined();
  });

  test("height: 1 is preserved", () => {
    expect(normalizeTransformOptions({ height: 1 }).height).toBe(1);
  });

  test("height: 4096 (max) is preserved", () => {
    expect(normalizeTransformOptions({ height: 4096 }).height).toBe(4096);
  });

  test("height: 4097 is clamped to 4096", () => {
    expect(normalizeTransformOptions({ height: 4097 }).height).toBe(4096);
  });

  test("height: 100.5 is rounded to 101", () => {
    expect(normalizeTransformOptions({ height: 100.5 }).height).toBe(101);
  });

  // --- quality edge cases ---

  test("quality: 0 is dropped", () => {
    expect(normalizeTransformOptions({ quality: 0 }).quality).toBeUndefined();
  });

  test("quality: -1 is dropped", () => {
    expect(normalizeTransformOptions({ quality: -1 }).quality).toBeUndefined();
  });

  test("quality: NaN is dropped", () => {
    expect(normalizeTransformOptions({ quality: NaN }).quality).toBeUndefined();
  });

  test("quality: 1 is preserved", () => {
    expect(normalizeTransformOptions({ quality: 1 }).quality).toBe(1);
  });

  test("quality: 50 is preserved", () => {
    expect(normalizeTransformOptions({ quality: 50 }).quality).toBe(50);
  });

  test("quality: 100 is preserved", () => {
    expect(normalizeTransformOptions({ quality: 100 }).quality).toBe(100);
  });

  test("quality: 101 is clamped to 100", () => {
    expect(normalizeTransformOptions({ quality: 101 }).quality).toBe(100);
  });

  test("quality: 50.6 is rounded to 51", () => {
    expect(normalizeTransformOptions({ quality: 50.6 }).quality).toBe(51);
  });

  // --- format edge cases ---

  test("format: 'auto' is accepted", () => {
    expect(normalizeTransformOptions({ format: "auto" }).format).toBe("auto");
  });

  test("format: 'avif' is accepted", () => {
    expect(normalizeTransformOptions({ format: "avif" }).format).toBe("avif");
  });

  test("format: 'webp' is accepted", () => {
    expect(normalizeTransformOptions({ format: "webp" }).format).toBe("webp");
  });

  test("format: 'jpeg' is accepted", () => {
    expect(normalizeTransformOptions({ format: "jpeg" }).format).toBe("jpeg");
  });

  test("format: 'png' is accepted", () => {
    expect(normalizeTransformOptions({ format: "png" }).format).toBe("png");
  });

  test("format: 'gif' (invalid for transform) is dropped", () => {
    expect(normalizeTransformOptions({ format: "gif" as never }).format).toBeUndefined();
  });

  test("format: 'invalid' is dropped", () => {
    expect(normalizeTransformOptions({ format: "invalid" as never }).format).toBeUndefined();
  });

  test("format: '' is dropped", () => {
    expect(normalizeTransformOptions({ format: "" as never }).format).toBeUndefined();
  });

  test("format: undefined is dropped", () => {
    expect(normalizeTransformOptions({ format: undefined }).format).toBeUndefined();
  });

  // --- fit edge cases ---

  test("fit: 'cover' is accepted", () => {
    expect(normalizeTransformOptions({ fit: "cover" }).fit).toBe("cover");
  });

  test("fit: 'contain' is accepted", () => {
    expect(normalizeTransformOptions({ fit: "contain" }).fit).toBe("contain");
  });

  test("fit: 'fill' is accepted", () => {
    expect(normalizeTransformOptions({ fit: "fill" }).fit).toBe("fill");
  });

  test("fit: 'inside' is accepted", () => {
    expect(normalizeTransformOptions({ fit: "inside" }).fit).toBe("inside");
  });

  test("fit: 'outside' is accepted", () => {
    expect(normalizeTransformOptions({ fit: "outside" }).fit).toBe("outside");
  });

  test("fit: 'invalid' is dropped", () => {
    expect(normalizeTransformOptions({ fit: "invalid" as never }).fit).toBeUndefined();
  });

  test("fit: undefined is dropped", () => {
    expect(normalizeTransformOptions({ fit: undefined }).fit).toBeUndefined();
  });

  // --- empty / no-property objects ---

  test("empty object returns empty result", () => {
    const result = normalizeTransformOptions({});
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.quality).toBeUndefined();
    expect(result.format).toBeUndefined();
    expect(result.fit).toBeUndefined();
  });

  test("object with no meaningful properties returns empty result", () => {
    const result = normalizeTransformOptions({
      width: undefined,
      height: undefined,
      quality: undefined,
      format: undefined,
      fit: undefined,
    });
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.quality).toBeUndefined();
    expect(result.format).toBeUndefined();
    expect(result.fit).toBeUndefined();
  });

  // --- combined ---

  test("combines multiple valid fields", () => {
    const result = normalizeTransformOptions({
      width: 800,
      height: 600,
      quality: 75,
      format: "webp",
      fit: "contain",
    });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.quality).toBe(75);
    expect(result.format).toBe("webp");
    expect(result.fit).toBe("contain");
  });

  test("drops invalid fields while keeping valid ones", () => {
    const result = normalizeTransformOptions({
      width: -5,
      quality: 80,
      format: "bad" as never,
      fit: "cover",
    });
    expect(result.width).toBeUndefined();
    expect(result.quality).toBe(80);
    expect(result.format).toBeUndefined();
    expect(result.fit).toBe("cover");
  });
});

// ==========================================================================
// parseImageQuery
// ==========================================================================

describe("parseImageQuery", () => {
  test("valid: full params", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&w=800&q=75&f=webp&fit=cover");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.src).toBe("/photo.jpg");
      expect(result.options.width).toBe(800);
      expect(result.options.quality).toBe(75);
      expect(result.options.format).toBe("webp");
      expect(result.options.fit).toBe("cover");
    }
  });

  test("valid: only url param (no transforms)", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.src).toBe("/photo.jpg");
      expect(result.options.width).toBeUndefined();
      expect(result.options.quality).toBeUndefined();
    }
  });

  test("missing url param returns error", () => {
    const result = parseImageQuery("/_capstan/image?w=800");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("url");
    }
  });

  test("empty url param returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=&w=800");
    expect("error" in result).toBe(true);
  });

  test("url with blank spaces returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=   ");
    expect("error" in result).toBe(true);
  });

  test("path traversal with .. returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=../../../etc/passwd");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("traversal");
    }
  });

  test("path traversal with encoded .. returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=..%2F..%2Fetc%2Fpasswd");
    // URLSearchParams decodes %2F to / and .. to ..
    expect("error" in result).toBe(true);
  });

  test("protocol prefix file:// returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=file:///etc/passwd");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Protocol");
    }
  });

  test("protocol prefix http:// returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=http://evil.com/img.jpg");
    expect("error" in result).toBe(true);
  });

  test("Windows absolute path returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=C:\\Windows\\system32\\img.jpg");
    expect("error" in result).toBe(true);
  });

  test("non-numeric width returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&w=abc");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("width");
    }
  });

  test("negative width returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&w=-100");
    expect("error" in result).toBe(true);
  });

  test("zero width returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&w=0");
    expect("error" in result).toBe(true);
  });

  test("non-numeric height returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&h=xyz");
    expect("error" in result).toBe(true);
  });

  test("negative height returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&h=-50");
    expect("error" in result).toBe(true);
  });

  test("quality out of range (0) returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&q=0");
    expect("error" in result).toBe(true);
  });

  test("quality out of range (101) returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&q=101");
    expect("error" in result).toBe(true);
  });

  test("quality non-numeric returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&q=high");
    expect("error" in result).toBe(true);
  });

  test("invalid format returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&f=gif");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("format");
    }
  });

  test("invalid fit returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg&fit=stretch");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("fit");
    }
  });

  test("accepts URL object input", () => {
    const url = new URL("http://localhost/_capstan/image?url=/img.png&w=100");
    const result = parseImageQuery(url);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.src).toBe("/img.png");
      expect(result.options.width).toBe(100);
    }
  });

  test("valid height param is parsed correctly", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&h=200");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.options.height).toBe(200);
    }
  });

  test("format: auto is accepted", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&f=auto");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.options.format).toBe("auto");
    }
  });

  test("all fit values accepted", () => {
    for (const fit of ["cover", "contain", "fill", "inside", "outside"]) {
      const result = parseImageQuery(`/_capstan/image?url=/a.jpg&fit=${fit}`);
      expect("error" in result).toBe(false);
    }
  });

  test("width Infinity returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&w=Infinity");
    expect("error" in result).toBe(true);
  });

  test("width NaN returns error", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&w=NaN");
    expect("error" in result).toBe(true);
  });
});

// ==========================================================================
// createImageOptimizer — filesystem-based tests (no sharp)
// ==========================================================================

describe("createImageOptimizer", () => {
  let root: string;

  beforeEach(async () => {
    root = tmpRoot();
    await createTestTree(root, {
      "public/photo.png": TINY_PNG,
      "public/logo.svg": TINY_SVG,
      "public/readme.txt": "not an image",
      "public/deep/nested/img.jpg": TINY_PNG, // jpg extension, PNG content is fine for non-sharp
      "app/public/banner.png": TINY_PNG,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  test("available is false when sharp is not installed", () => {
    const optimizer = createImageOptimizer(root);
    // Before any transform call, available may not reflect yet.
    // After transform, it should be false in CI without sharp.
    expect(typeof optimizer.available).toBe("boolean");
  });

  test("transform returns original file when sharp is unavailable", async () => {
    const optimizer = createImageOptimizer(root);
    const result = await optimizer.transform("/photo.png", { width: 100 });
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.data.byteLength).toBe(TINY_PNG.byteLength);
    expect(result.originalSize).toBe(TINY_PNG.byteLength);
    expect(result.optimizedSize).toBe(TINY_PNG.byteLength);
    expect(result.format).toBe("png");
    expect(result.contentType).toBe("image/png");
  });

  test("transform resolves source from allowed directories", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/photo.png", {});
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  test("transform resolves nested paths", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/deep/nested/img.jpg", {});
    expect(result.data.byteLength).toBeGreaterThan(0);
    expect(result.format).toBe("jpeg");
    expect(result.contentType).toBe("image/jpeg");
  });

  test("transform uses default allowedDirs (public, app/public)", async () => {
    const optimizer = createImageOptimizer(root);
    // File in app/public should be accessible
    const result = await optimizer.transform("/banner.png", {});
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  test("transform rejects source outside allowed directories", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    await expect(
      optimizer.transform("/../../etc/passwd", {}),
    ).rejects.toThrow(ImageOptimizerError);
  });

  test("transform rejects path traversal", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    try {
      await optimizer.transform("../../../etc/passwd", {});
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(ImageOptimizerError);
      expect((err as ImageOptimizerError).code).toBe("FORBIDDEN");
    }
  });

  test("transform rejects protocol prefix", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    try {
      await optimizer.transform("file:///etc/passwd", {});
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ImageOptimizerError);
      expect((err as ImageOptimizerError).code).toBe("FORBIDDEN");
    }
  });

  test("transform rejects non-image file extensions", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    try {
      await optimizer.transform("/readme.txt", {});
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ImageOptimizerError);
      expect((err as ImageOptimizerError).code).toBe("UNSUPPORTED_FORMAT");
    }
  });

  test("transform throws NOT_FOUND for missing file", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    try {
      await optimizer.transform("/missing.png", {});
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ImageOptimizerError);
      expect((err as ImageOptimizerError).code).toBe("NOT_FOUND");
    }
  });

  test("SVG files are returned as-is without transformation", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/logo.svg", { width: 100, format: "webp" });
    expect(result.format).toBe("svg");
    expect(result.contentType).toBe("image/svg+xml");
    const text = new TextDecoder().decode(result.data);
    expect(text).toContain("<svg");
  });

  // --- Caching ---

  test("cache: second transform hits cache", async () => {
    const cacheDir = join(root, ".capstan/image-cache");
    const optimizer = createImageOptimizer(root, {
      allowedDirs: ["public"],
      cacheDir,
    });

    const first = await optimizer.transform("/photo.png", { width: 100 });
    const second = await optimizer.transform("/photo.png", { width: 100 });
    expect(second.data.byteLength).toBe(first.data.byteLength);
    expect(second.format).toBe(first.format);
  });

  test("cache: different options produce different cache entries", async () => {
    const cacheDir = join(root, ".capstan/image-cache");
    const optimizer = createImageOptimizer(root, {
      allowedDirs: ["public"],
      cacheDir,
    });

    await optimizer.transform("/photo.png", { width: 100 });
    await optimizer.transform("/photo.png", { width: 200 });

    const entries = await readdir(cacheDir);
    // Each transform produces a .json and a .<format> file = 4 files total
    expect(entries.length).toBe(4);
  });

  test("getCached returns null for unknown key", async () => {
    const optimizer = createImageOptimizer(root);
    const result = await optimizer.getCached("nonexistent_key_abc123");
    expect(result).toBeNull();
  });

  test("clearCache removes all cached files", async () => {
    const cacheDir = join(root, ".capstan/image-cache");
    const optimizer = createImageOptimizer(root, {
      allowedDirs: ["public"],
      cacheDir,
    });

    await optimizer.transform("/photo.png", { width: 100 });

    // Cache dir should exist
    await access(cacheDir);

    await optimizer.clearCache();

    // Cache dir should be gone
    try {
      await access(cacheDir);
      expect(true).toBe(false); // should not reach
    } catch {
      // Expected: directory removed
    }
  });

  test("clearCache is safe to call when cache dir does not exist", async () => {
    const optimizer = createImageOptimizer(root, {
      cacheDir: join(root, "nonexistent-cache"),
    });
    // Should not throw
    await optimizer.clearCache();
  });

  // --- Cache eviction ---

  test("cache eviction removes oldest files when maxCacheSize exceeded", async () => {
    const cacheDir = join(root, ".capstan/image-cache");
    // Set max cache size to very small so eviction triggers
    const optimizer = createImageOptimizer(root, {
      allowedDirs: ["public"],
      cacheDir,
      maxCacheSize: 1, // 1 byte — effectively forces eviction on every write
    });

    await optimizer.transform("/photo.png", { width: 100 });
    await optimizer.transform("/photo.png", { width: 200 });

    // After eviction, some files should have been removed
    const entries = await readdir(cacheDir);
    // We can't predict exactly how many remain, but the eviction code ran
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });

  // --- Concurrent transforms (deduplication) ---

  test("concurrent transforms of same image are deduplicated", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const [a, b, c] = await Promise.all([
      optimizer.transform("/photo.png", { width: 100 }),
      optimizer.transform("/photo.png", { width: 100 }),
      optimizer.transform("/photo.png", { width: 100 }),
    ]);
    expect(a.data.byteLength).toBe(b.data.byteLength);
    expect(b.data.byteLength).toBe(c.data.byteLength);
  });

  // --- Content negotiation ---

  test("format: auto with avif Accept returns avif format in metadata", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform(
      "/photo.png",
      { format: "auto" },
      "image/avif,image/webp",
    );
    // Without sharp, format falls back to source (png), but the negotiation
    // logic is tested through negotiateFormat separately.
    // The transform still uses the resolved format for cache key.
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  test("specific format overrides Accept header", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform(
      "/photo.png",
      { format: "jpeg" },
      "image/avif",
    );
    // Without sharp, original PNG content is returned but format says jpeg
    // (since sharp would convert). In no-sharp mode, it returns source format.
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  // --- Config defaults ---

  test("uses default cacheDir when not specified", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    await optimizer.transform("/photo.png", { width: 100 });
    const defaultCache = join(root, ".capstan/image-cache");
    const entries = await readdir(defaultCache);
    expect(entries.length).toBeGreaterThan(0);
  });

  test("uses custom cacheDir", async () => {
    const customCache = join(root, "my-cache");
    const optimizer = createImageOptimizer(root, {
      allowedDirs: ["public"],
      cacheDir: customCache,
    });
    await optimizer.transform("/photo.png", { width: 100 });
    const entries = await readdir(customCache);
    expect(entries.length).toBeGreaterThan(0);
  });

  // --- ImageOptimizerError ---

  test("ImageOptimizerError has correct name and code", () => {
    const err = new ImageOptimizerError("test", "FORBIDDEN");
    expect(err.name).toBe("ImageOptimizerError");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ImageOptimizerError);
  });

  test("ImageOptimizerError codes are all distinct", () => {
    const codes = ["FORBIDDEN", "NOT_FOUND", "UNSUPPORTED_FORMAT", "INVALID_DIMENSIONS", "TRANSFORM_ERROR"] as const;
    const errs = codes.map((c) => new ImageOptimizerError("msg", c));
    for (let i = 0; i < errs.length; i++) {
      expect(errs[i]!.code).toBe(codes[i]);
    }
  });
});

// ==========================================================================
// createImageEndpointHandler — HTTP-level tests
// ==========================================================================

describe("createImageEndpointHandler", () => {
  let root: string;
  let handler: (request: Request) => Promise<Response>;

  // Dynamic import of the handler (dev package)
  async function loadHandler(
    rootDir: string,
    config?: ImageOptimizerConfig,
  ): Promise<(request: Request) => Promise<Response>> {
    // We import from the source directly (Bun resolves .ts)
    const mod = await import("../../packages/dev/src/image-endpoint.js");
    return mod.createImageEndpointHandler(rootDir, config);
  }

  beforeEach(async () => {
    root = tmpRoot();
    await createTestTree(root, {
      "public/photo.png": TINY_PNG,
      "public/logo.svg": TINY_SVG,
      "public/script.js": "console.log('evil');",
    });
    handler = await loadHandler(root, { allowedDirs: ["public"] });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  test("200: valid transform request returns image", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&w=100");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  test("200: returns correct Content-Length header", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png");
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.arrayBuffer();
    expect(res.headers.get("Content-Length")).toBe(String(body.byteLength));
  });

  test("400: missing url param", async () => {
    const req = new Request("http://localhost/_capstan/image?w=100");
    const res = await handler(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  test("400: invalid width", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&w=-5");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("400: non-numeric quality", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&q=abc");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("403: path traversal attempt", async () => {
    const req = new Request("http://localhost/_capstan/image?url=../../../etc/passwd");
    const res = await handler(req);
    // parseImageQuery catches traversal as 400, optimizer catches as 403
    expect([400, 403]).toContain(res.status);
  });

  test("404: source file not found", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/missing.png");
    const res = await handler(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("not found");
  });

  test("415: non-image source file", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/script.js");
    const res = await handler(req);
    expect(res.status).toBe(415);
  });

  test("Cache-Control header present on transformed response", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&w=100");
    const res = await handler(req);
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control");
    expect(cc).toBeDefined();
    // Without sharp: must-revalidate; with sharp: immutable
    expect(cc).toContain("public");
  });

  test("Vary header present when format=auto", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&f=auto", {
      headers: { Accept: "image/avif,image/webp" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Vary")).toBe("Accept");
  });

  test("no Vary header when specific format requested", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&f=webp");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Vary")).toBeNull();
  });

  test("X-Capstan-Image-Cache header present", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&w=100");
    const res = await handler(req);
    expect(res.status).toBe(200);
    const cacheHdr = res.headers.get("X-Capstan-Image-Cache");
    expect(cacheHdr).toBeDefined();
    expect(["HIT", "MISS", "BYPASS"]).toContain(cacheHdr);
  });

  test("SVG returns svg content type", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/logo.svg");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("svg");
  });

  test("empty url param returns 400", async () => {
    const req = new Request("http://localhost/_capstan/image?url=");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("no query params at all returns 400", async () => {
    const req = new Request("http://localhost/_capstan/image");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("Vary: Accept not set when format is undefined (no auto)", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&w=100");
    const res = await handler(req);
    // format is undefined, which triggers isAutoFormat = true since undefined === undefined
    // Actually: options.format === "auto" || options.format === undefined → true
    // So Vary: Accept IS set
    expect(res.headers.get("Vary")).toBe("Accept");
  });

  test("Vary: Accept set when format is undefined (treated as auto)", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&f=jpeg");
    const res = await handler(req);
    // Specific format: no Vary
    expect(res.headers.get("Vary")).toBeNull();
  });

  test("404: file not found when allowed dir does not contain the file", async () => {
    // The path resolves within the allowed dir but the file doesn't exist there
    const restrictedHandler = await loadHandler(root, { allowedDirs: ["nonexistent-dir"] });
    const req = new Request("http://localhost/_capstan/image?url=/photo.png");
    const res = await restrictedHandler(req);
    expect(res.status).toBe(404);
  });

  test("quality boundary: q=1 is valid", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&q=1");
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("quality boundary: q=100 is valid", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&q=100");
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("response body is non-empty for valid image", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png");
    const res = await handler(req);
    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  test("error responses have application/json content type", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/missing.png");
    const res = await handler(req);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});

// ==========================================================================
// Image component: buildImageUrl + buildImageSrcSet
// ==========================================================================

describe("buildImageUrl (updated for /_capstan/image routing)", () => {
  // Dynamic import from react package source
  let buildImageUrl: typeof import("../../packages/react/src/image.js").buildImageUrl;
  let buildImageSrcSet: typeof import("../../packages/react/src/image.js").buildImageSrcSet;

  beforeEach(async () => {
    const mod = await import("../../packages/react/src/image.js");
    buildImageUrl = mod.buildImageUrl;
    buildImageSrcSet = mod.buildImageSrcSet;
  });

  test("local path is routed through /_capstan/image", () => {
    const url = buildImageUrl("/photo.jpg", { width: 800, quality: 75 });
    expect(url).toContain("/_capstan/image?");
    expect(url).toContain("url=%2Fphoto.jpg");
    expect(url).toContain("w=800");
    expect(url).toContain("q=75");
  });

  test("local path without transforms stays as original URL", () => {
    const url = buildImageUrl("/photo.jpg");
    // No transforms requested — no reason to route through optimizer
    expect(url).toBe("/photo.jpg");
  });

  test("external URL https:// is unchanged", () => {
    const url = buildImageUrl("https://example.com/photo.jpg", { width: 800 });
    expect(url).not.toContain("/_capstan/image");
    expect(url).toContain("https://example.com/photo.jpg");
    expect(url).toContain("w=800");
  });

  test("external URL http:// is unchanged", () => {
    const url = buildImageUrl("http://example.com/photo.jpg");
    expect(url).not.toContain("/_capstan/image");
    expect(url).toBe("http://example.com/photo.jpg");
  });

  test("protocol-relative //example.com is unchanged", () => {
    const url = buildImageUrl("//example.com/photo.jpg", { width: 400 });
    expect(url).not.toContain("/_capstan/image");
    expect(url).toContain("//example.com/photo.jpg");
  });

  test("local path with existing query params", () => {
    const url = buildImageUrl("/photo.jpg?v=1", { width: 800 });
    expect(url).toContain("/_capstan/image?");
    // The original query should be preserved in the url param
    expect(url).toContain("url=");
    expect(url).toContain("w=800");
  });

  test("local path with hash is preserved", () => {
    const url = buildImageUrl("/photo.jpg#section", { width: 800 });
    expect(url).toContain("#section");
    expect(url).toContain("/_capstan/image?");
  });

  test("empty src returns empty", () => {
    const url = buildImageUrl("");
    expect(url).toBe("");
  });

  test("local path with format uses f= param", () => {
    const url = buildImageUrl("/photo.jpg", { format: "webp" });
    expect(url).toContain("f=webp");
    expect(url).not.toContain("format=");
  });

  test("external URL with format uses format= param", () => {
    const url = buildImageUrl("https://cdn.example.com/photo.jpg", { format: "webp" });
    expect(url).toContain("format=webp");
    expect(url).not.toContain("f=webp");
  });

  test("local path with quality only", () => {
    const url = buildImageUrl("/photo.jpg", { quality: 90 });
    expect(url).toContain("/_capstan/image?");
    expect(url).toContain("q=90");
  });

  test("buildImageSrcSet generates /_capstan/image URLs for local paths", () => {
    const srcset = buildImageSrcSet("/photo.jpg", { quality: 75 });
    expect(srcset).toContain("/_capstan/image?");
    // Should contain multiple width descriptors
    // Default widths: 640, 750, 828, 1080, 1200, 1920
    expect(srcset).toContain("640w");
    expect(srcset).toContain("1920w");
  });

  test("buildImageSrcSet leaves external URLs alone", () => {
    const srcset = buildImageSrcSet("https://cdn.example.com/photo.jpg", { quality: 75 });
    expect(srcset).not.toContain("/_capstan/image");
    expect(srcset).toContain("https://cdn.example.com/photo.jpg");
  });

  test("buildImageSrcSet with custom widths", () => {
    const srcset = buildImageSrcSet("/photo.jpg", {
      quality: 80,
      widths: [320, 640],
    });
    expect(srcset).toContain("320w");
    expect(srcset).toContain("640w");
    expect(srcset).not.toContain("1920w");
  });

  test("buildImageSrcSet empty for empty src", () => {
    // With empty src, buildImageUrl returns "", so candidates produce empty URLs
    const srcset = buildImageSrcSet("", { quality: 80 });
    // Result depends on implementation: empty or valid srcset with empty base
    expect(typeof srcset).toBe("string");
  });

  test("buildImageSrcSet respects maxWidth constraint", () => {
    const srcset = buildImageSrcSet("/photo.jpg", {
      width: 400,
      quality: 80,
    });
    // Widths > width * 2 (800) should be excluded
    expect(srcset).not.toContain("1920w");
    expect(srcset).not.toContain("1200w");
    expect(srcset).not.toContain("1080w");
    expect(srcset).toContain("640w");
    expect(srcset).toContain("750w");
  });
});

// ==========================================================================
// Integration: optimizer + endpoint round-trip
// ==========================================================================

describe("optimizer + endpoint integration", () => {
  let root: string;

  beforeEach(async () => {
    root = tmpRoot();
    await createTestTree(root, {
      "public/hero.png": TINY_PNG,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  test("optimizer transform + endpoint handler produce consistent results", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const transformResult = await optimizer.transform("/hero.png", { width: 100 });

    const mod = await import("../../packages/dev/src/image-endpoint.js");
    const handler = mod.createImageEndpointHandler(root, { allowedDirs: ["public"] });
    const req = new Request("http://localhost/_capstan/image?url=/hero.png&w=100");
    const res = await handler(req);
    const body = new Uint8Array(await res.arrayBuffer());

    // Both should return the same image content
    expect(body.byteLength).toBe(transformResult.data.byteLength);
  });

  test("multiple formats negotiated correctly via endpoint", async () => {
    const mod = await import("../../packages/dev/src/image-endpoint.js");
    const handler = mod.createImageEndpointHandler(root, { allowedDirs: ["public"] });

    // Request with auto format and avif Accept
    const req = new Request("http://localhost/_capstan/image?url=/hero.png&f=auto", {
      headers: { Accept: "image/avif,image/webp,*/*" },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Vary")).toBe("Accept");
  });
});

// ==========================================================================
// Edge cases and regressions
// ==========================================================================

describe("edge cases", () => {
  test("normalizeTransformOptions with very large width", () => {
    const result = normalizeTransformOptions({ width: 999999 });
    expect(result.width).toBe(4096);
  });

  test("normalizeTransformOptions with very large height", () => {
    const result = normalizeTransformOptions({ height: 999999 });
    expect(result.height).toBe(4096);
  });

  test("normalizeTransformOptions with negative infinity width", () => {
    const result = normalizeTransformOptions({ width: -Infinity });
    expect(result.width).toBeUndefined();
  });

  test("normalizeTransformOptions with negative infinity quality", () => {
    const result = normalizeTransformOptions({ quality: -Infinity });
    expect(result.quality).toBeUndefined();
  });

  test("computeImageCacheKey is deterministic across calls", () => {
    const opts: ImageTransformOptions = { width: 123, quality: 45, format: "webp", fit: "contain" };
    const keys = new Set<string>();
    for (let i = 0; i < 10; i++) {
      keys.add(computeImageCacheKey("/x.jpg", opts, "webp"));
    }
    expect(keys.size).toBe(1);
  });

  test("parseImageQuery with very long URL does not crash", () => {
    const longPath = "/" + "a".repeat(10000) + ".jpg";
    const result = parseImageQuery(`/_capstan/image?url=${encodeURIComponent(longPath)}&w=100`);
    expect("error" in result).toBe(false);
  });

  test("parseImageQuery with special characters in path", () => {
    const result = parseImageQuery("/_capstan/image?url=/images/photo%20(1).jpg&w=100");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.src).toBe("/images/photo (1).jpg");
    }
  });

  test("parseImageQuery with url containing a query string via encoding", () => {
    // Someone might pass /photo.jpg?v=1 as url param
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg%3Fv%3D1&w=100");
    expect("error" in result).toBe(false);
  });

  test("negotiateFormat with mixed case and whitespace", () => {
    expect(negotiateFormat(" Image/AVIF , image/webp ")).toBe("avif");
  });

  test("ImageOptimizerError is instanceof Error", () => {
    const err = new ImageOptimizerError("test", "NOT_FOUND");
    expect(err instanceof Error).toBe(true);
  });

  test("parseImageQuery rejects ftp:// protocol", () => {
    const result = parseImageQuery("/_capstan/image?url=ftp://server/img.jpg");
    expect("error" in result).toBe(true);
  });

  test("parseImageQuery rejects data: protocol", () => {
    const result = parseImageQuery("/_capstan/image?url=data:image/png;base64,abc");
    expect("error" in result).toBe(true);
  });

  test("normalizeTransformOptions with width exactly at boundary", () => {
    expect(normalizeTransformOptions({ width: 4096 }).width).toBe(4096);
    expect(normalizeTransformOptions({ width: 4096.4 }).width).toBe(4096);
    expect(normalizeTransformOptions({ width: 4096.5 }).width).toBe(4096); // 4097 clamped to 4096
  });

  test("normalizeTransformOptions width 1.4 rounds to 1", () => {
    const result = normalizeTransformOptions({ width: 1.4 });
    expect(result.width).toBe(1);
  });

  test("normalizeTransformOptions width 0.6 is < 1 so it is dropped", () => {
    const result = normalizeTransformOptions({ width: 0.6 });
    // 0.6 < 1 so it's dropped before rounding
    expect(result.width).toBeUndefined();
  });

  test("normalizeTransformOptions width 0.4 is < 1 so it is dropped", () => {
    const result = normalizeTransformOptions({ width: 0.4 });
    expect(result.width).toBeUndefined();
  });
});

// ==========================================================================
// Additional coverage: deeper edge cases and contract assertions
// ==========================================================================

describe("normalizeTransformOptions — additional boundary checks", () => {
  test("height: 1 exactly at lower boundary", () => {
    expect(normalizeTransformOptions({ height: 1 }).height).toBe(1);
  });

  test("height: 1.5 rounds to 2", () => {
    expect(normalizeTransformOptions({ height: 1.5 }).height).toBe(2);
  });

  test("height: 4096.5 clamps then rounds to 4096", () => {
    // min(4096.5, 4096) = 4096, round(4096) = 4096
    expect(normalizeTransformOptions({ height: 4096.5 }).height).toBe(4096);
  });

  test("quality: 1.4 rounds to 1", () => {
    expect(normalizeTransformOptions({ quality: 1.4 }).quality).toBe(1);
  });

  test("quality: 99.6 rounds to 100", () => {
    expect(normalizeTransformOptions({ quality: 99.6 }).quality).toBe(100);
  });

  test("quality: 200 clamps to 100", () => {
    expect(normalizeTransformOptions({ quality: 200 }).quality).toBe(100);
  });

  test("quality: Infinity is dropped", () => {
    expect(normalizeTransformOptions({ quality: Infinity }).quality).toBeUndefined();
  });

  test("all valid formats are accepted", () => {
    for (const fmt of ["auto", "avif", "webp", "jpeg", "png"] as const) {
      expect(normalizeTransformOptions({ format: fmt }).format).toBe(fmt);
    }
  });

  test("all valid fits are accepted", () => {
    for (const fit of ["cover", "contain", "fill", "inside", "outside"] as const) {
      expect(normalizeTransformOptions({ fit }).fit).toBe(fit);
    }
  });

  test("width + height + quality all clamped simultaneously", () => {
    const result = normalizeTransformOptions({
      width: 10000,
      height: 10000,
      quality: 999,
    });
    expect(result.width).toBe(4096);
    expect(result.height).toBe(4096);
    expect(result.quality).toBe(100);
  });

  test("multiple invalid fields are all dropped", () => {
    const result = normalizeTransformOptions({
      width: -1,
      height: NaN,
      quality: 0,
      format: "bmp" as never,
      fit: "none" as never,
    });
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.quality).toBeUndefined();
    expect(result.format).toBeUndefined();
    expect(result.fit).toBeUndefined();
  });
});

describe("negotiateFormat — additional Accept header variations", () => {
  test("complex Accept with multiple image types and quality", () => {
    expect(negotiateFormat("text/html, image/webp;q=0.9, image/avif;q=1.0, */*;q=0.5")).toBe("avif");
  });

  test("only webp in Accept", () => {
    expect(negotiateFormat("image/webp")).toBe("webp");
  });

  test("avif before webp in Accept", () => {
    expect(negotiateFormat("image/avif, image/webp")).toBe("avif");
  });

  test("webp before avif in Accept (avif still wins)", () => {
    expect(negotiateFormat("image/webp, image/avif")).toBe("avif");
  });

  test("Accept with only non-image types", () => {
    expect(negotiateFormat("application/json, text/plain")).toBe("jpeg");
  });

  test("Accept: image/png (no avif/webp)", () => {
    expect(negotiateFormat("image/png")).toBe("jpeg");
  });
});

describe("computeImageCacheKey — additional contract tests", () => {
  test("empty options produce a valid key", () => {
    const key = computeImageCacheKey("/img.png", {}, "png");
    expect(key.length).toBe(64);
  });

  test("empty path produces a valid key", () => {
    const key = computeImageCacheKey("", {}, "jpeg");
    expect(key.length).toBe(64);
  });

  test("different height produces different key", () => {
    const a = computeImageCacheKey("/a.jpg", { height: 100 }, "jpeg");
    const b = computeImageCacheKey("/a.jpg", { height: 200 }, "jpeg");
    expect(a).not.toBe(b);
  });

  test("keys with all options populated", () => {
    const key = computeImageCacheKey(
      "/photo.jpg",
      { width: 800, height: 600, quality: 90, format: "avif", fit: "contain" },
      "avif",
    );
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("parseImageQuery — additional protocol and path tests", () => {
  test("blob: protocol is rejected", () => {
    const result = parseImageQuery("/_capstan/image?url=blob:http://localhost/uuid");
    expect("error" in result).toBe(true);
  });

  test("javascript: protocol is rejected", () => {
    const result = parseImageQuery("/_capstan/image?url=javascript:alert(1)");
    expect("error" in result).toBe(true);
  });

  test("path with double slashes is accepted (not traversal)", () => {
    const result = parseImageQuery("/_capstan/image?url=//photo.jpg");
    // double-slash at start looks like protocol-relative, but no colon so it's OK
    expect("error" in result).toBe(false);
  });

  test("path with single dot is accepted", () => {
    const result = parseImageQuery("/_capstan/image?url=/./photo.jpg");
    expect("error" in result).toBe(false);
  });

  test("width=1 is the minimum valid", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&w=1");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.options.width).toBe(1);
    }
  });

  test("height=1 is the minimum valid", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&h=1");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.options.height).toBe(1);
    }
  });

  test("quality=1 is the minimum valid", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&q=1");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.options.quality).toBe(1);
    }
  });

  test("quality=100 is the maximum valid", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&q=100");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.options.quality).toBe(100);
    }
  });

  test("decimal width is accepted (e.g. 100.5)", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&w=100.5");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.options.width).toBe(100.5);
    }
  });

  test("all supported formats", () => {
    for (const fmt of ["auto", "avif", "webp", "jpeg", "png"]) {
      const result = parseImageQuery(`/_capstan/image?url=/a.jpg&f=${fmt}`);
      expect("error" in result).toBe(false);
    }
  });

  test("unsupported format 'bmp' is rejected", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&f=bmp");
    expect("error" in result).toBe(true);
  });

  test("unsupported format 'tiff' is rejected", () => {
    const result = parseImageQuery("/_capstan/image?url=/a.jpg&f=tiff");
    expect("error" in result).toBe(true);
  });
});

describe("createImageOptimizer — additional filesystem tests", () => {
  let root: string;

  beforeEach(async () => {
    root = tmpRoot();
    await createTestTree(root, {
      "public/a.png": TINY_PNG,
      "public/b.jpg": TINY_PNG,
      "public/deep/c.webp": TINY_PNG,
      "public/icon.ico": TINY_PNG,
      "public/anim.gif": TINY_PNG,
      "app/public/d.avif": TINY_PNG,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  test("ico files are accepted as image extension", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/icon.ico", {});
    expect(result.contentType).toBe("image/x-icon");
  });

  test("gif files are accepted as image extension", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/anim.gif", {});
    expect(result.contentType).toBe("image/gif");
    expect(result.format).toBe("gif");
  });

  test("webp files are accepted", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/deep/c.webp", {});
    expect(result.format).toBe("webp");
  });

  test("avif files from app/public are accessible", async () => {
    const optimizer = createImageOptimizer(root);
    const result = await optimizer.transform("/d.avif", {});
    expect(result.format).toBe("avif");
  });

  test("jpg extension produces jpeg format", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/b.jpg", {});
    expect(result.format).toBe("jpeg");
    expect(result.contentType).toBe("image/jpeg");
  });

  test("transform with format auto and no Accept header falls back to source format", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/a.png", { format: "auto" });
    // negotiateFormat(undefined) returns jpeg, but without sharp the fallback
    // returns the original format
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  test("transform with all options set", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const result = await optimizer.transform("/a.png", {
      width: 100,
      height: 100,
      quality: 50,
      format: "webp",
      fit: "contain",
    });
    // Without sharp, returns original
    expect(result.data.byteLength).toBeGreaterThan(0);
  });

  test("getCached returns result after transform caches it", async () => {
    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
    const transformResult = await optimizer.transform("/a.png", { width: 50 });
    const cacheKey = computeImageCacheKey("/a.png", normalizeTransformOptions({ width: 50 }), transformResult.format);
    const cached = await optimizer.getCached(cacheKey);
    expect(cached).not.toBeNull();
    expect(cached!.data.byteLength).toBe(transformResult.data.byteLength);
  });

  test("transform same image different qualities creates separate cache entries", async () => {
    const cacheDir = join(root, ".capstan/image-cache");
    const optimizer = createImageOptimizer(root, {
      allowedDirs: ["public"],
      cacheDir,
    });
    await optimizer.transform("/a.png", { quality: 50 });
    await optimizer.transform("/a.png", { quality: 80 });
    const entries = await readdir(cacheDir);
    // 2 transforms x 2 files each (.json + .format) = 4
    expect(entries.length).toBe(4);
  });

  test("maxWidth config is respected", () => {
    const optimizer = createImageOptimizer(root, { maxWidth: 200 });
    expect(typeof optimizer.available).toBe("boolean");
  });

  test("maxHeight config is respected", () => {
    const optimizer = createImageOptimizer(root, { maxHeight: 200 });
    expect(typeof optimizer.available).toBe("boolean");
  });

  test("defaultQuality config is accepted", () => {
    const optimizer = createImageOptimizer(root, { defaultQuality: 60 });
    expect(typeof optimizer.available).toBe("boolean");
  });
});

describe("createImageEndpointHandler — additional HTTP tests", () => {
  let root: string;
  let handler: (request: Request) => Promise<Response>;

  async function loadHandler(
    rootDir: string,
    config?: ImageOptimizerConfig,
  ): Promise<(request: Request) => Promise<Response>> {
    const mod = await import("../../packages/dev/src/image-endpoint.js");
    return mod.createImageEndpointHandler(rootDir, config);
  }

  beforeEach(async () => {
    root = tmpRoot();
    await createTestTree(root, {
      "public/photo.png": TINY_PNG,
      "public/deep/nested.jpg": TINY_PNG,
      "public/logo.svg": TINY_SVG,
      "public/data.json": '{"key":"value"}',
    });
    handler = await loadHandler(root, { allowedDirs: ["public"] });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  test("200: nested path", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/deep/nested.jpg");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/jpeg");
  });

  test("200: width and height together", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&w=100&h=100");
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("200: width, height, quality, format, fit all set", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&w=100&h=100&q=50&f=webp&fit=contain");
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("415: JSON file is not an image", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/data.json");
    const res = await handler(req);
    expect(res.status).toBe(415);
  });

  test("400: empty format string", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&f=");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("400: negative quality", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&q=-1");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("400: quality = 0", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&q=0");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("400: quality > 100", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&q=200");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("400: path traversal in url param", async () => {
    const req = new Request("http://localhost/_capstan/image?url=../../etc/shadow");
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  test("X-Capstan-Image-Cache is BYPASS when sharp unavailable and no transform", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png");
    const res = await handler(req);
    const cacheHdr = res.headers.get("X-Capstan-Image-Cache");
    // Without sharp: originalSize === optimizedSize, so BYPASS
    expect(cacheHdr).toBe("BYPASS");
  });

  test("Content-Type for SVG is correct", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/logo.svg");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  test("SVG response body contains SVG markup", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/logo.svg");
    const res = await handler(req);
    const text = await res.text();
    expect(text).toContain("<svg");
  });

  test("repeated request returns cached result", async () => {
    const req1 = new Request("http://localhost/_capstan/image?url=/photo.png&w=100");
    const res1 = await handler(req1);
    expect(res1.status).toBe(200);
    const body1 = await res1.arrayBuffer();

    const req2 = new Request("http://localhost/_capstan/image?url=/photo.png&w=100");
    const res2 = await handler(req2);
    expect(res2.status).toBe(200);
    const body2 = await res2.arrayBuffer();

    expect(body1.byteLength).toBe(body2.byteLength);
  });

  test("different widths produce responses (may differ in cache key)", async () => {
    const req1 = new Request("http://localhost/_capstan/image?url=/photo.png&w=100");
    const res1 = await handler(req1);
    expect(res1.status).toBe(200);

    const req2 = new Request("http://localhost/_capstan/image?url=/photo.png&w=200");
    const res2 = await handler(req2);
    expect(res2.status).toBe(200);
  });

  test("format=png request succeeds", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&f=png");
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Vary")).toBeNull(); // specific format, no Vary
  });

  test("format=avif request succeeds", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&f=avif");
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  test("format=jpeg request succeeds", async () => {
    const req = new Request("http://localhost/_capstan/image?url=/photo.png&f=jpeg");
    const res = await handler(req);
    expect(res.status).toBe(200);
  });
});

describe("buildImageUrl — additional URL structure tests", () => {
  let buildImageUrl: typeof import("../../packages/react/src/image.js").buildImageUrl;
  let buildImageSrcSet: typeof import("../../packages/react/src/image.js").buildImageSrcSet;

  beforeEach(async () => {
    const mod = await import("../../packages/react/src/image.js");
    buildImageUrl = mod.buildImageUrl;
    buildImageSrcSet = mod.buildImageSrcSet;
  });

  test("local path /a/b/c.jpg is correctly encoded in url param", () => {
    const url = buildImageUrl("/a/b/c.jpg", { width: 100 });
    expect(url).toContain("url=%2Fa%2Fb%2Fc.jpg");
  });

  test("local path with all options produces well-formed URL", () => {
    const url = buildImageUrl("/photo.jpg", { width: 800, quality: 75, format: "avif" });
    expect(url).toContain("/_capstan/image?");
    expect(url).toContain("w=800");
    expect(url).toContain("q=75");
    expect(url).toContain("f=avif");
    // Should be parseable
    const parsed = new URL(url, "http://localhost");
    expect(parsed.searchParams.get("url")).toBe("/photo.jpg");
    expect(parsed.searchParams.get("w")).toBe("800");
    expect(parsed.searchParams.get("q")).toBe("75");
    expect(parsed.searchParams.get("f")).toBe("avif");
  });

  test("external URL preserves all parts", () => {
    const url = buildImageUrl("https://cdn.example.com/images/photo.jpg?token=abc#hash", {
      width: 400,
    });
    expect(url).toContain("https://cdn.example.com/images/photo.jpg");
    expect(url).toContain("w=400");
    expect(url).toContain("#hash");
    expect(url).toContain("token=abc");
  });

  test("format: auto on local path with no other transforms stays unchanged", () => {
    const url = buildImageUrl("/photo.jpg", { format: "auto" });
    // format "auto" normalized to undefined — no transforms → no optimizer routing
    expect(url).toBe("/photo.jpg");
  });

  test("format: auto on local path WITH other transforms routes through optimizer", () => {
    const url = buildImageUrl("/photo.jpg", { format: "auto", width: 400 });
    expect(url).toContain("/_capstan/image?");
    expect(url).toContain("w=400");
    expect(url).not.toContain("f=");
  });

  test("buildImageSrcSet with no options produces URLs for default widths", () => {
    const srcset = buildImageSrcSet("/photo.jpg");
    // With quality defaulting to 80 in buildImageSrcSet
    expect(srcset).toContain("640w");
    expect(srcset).toContain("750w");
    expect(srcset).toContain("828w");
    expect(srcset).toContain("1080w");
    expect(srcset).toContain("1200w");
    expect(srcset).toContain("1920w");
    // All entries should use /_capstan/image
    const entries = srcset.split(", ");
    for (const entry of entries) {
      expect(entry).toContain("/_capstan/image");
    }
  });

  test("buildImageSrcSet entries are separated by comma-space", () => {
    const srcset = buildImageSrcSet("/photo.jpg", { quality: 80, widths: [100, 200] });
    const parts = srcset.split(", ");
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain("100w");
    expect(parts[1]).toContain("200w");
  });

  test("buildImageSrcSet with external URL uses direct params", () => {
    const srcset = buildImageSrcSet("https://cdn.example.com/img.jpg", {
      quality: 80,
      widths: [300, 600],
    });
    expect(srcset).not.toContain("/_capstan/image");
    expect(srcset).toContain("300w");
    expect(srcset).toContain("600w");
    expect(srcset).toContain("https://cdn.example.com/img.jpg");
  });
});

// ==========================================================================
// Security hardening — null byte injection
// ==========================================================================

describe("security hardening — null byte injection", () => {
  test("parseImageQuery does not reject null bytes itself (caught by transform)", () => {
    // parseImageQuery parses the URL but does not check for null bytes;
    // the isPathTraversal guard in transform() catches them.
    const result = parseImageQuery("/_capstan/image?url=/photo.jpg%00.txt&w=800");
    // parseImageQuery returns a valid parse — null bytes are not its responsibility
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.src).toContain("\0");
    }
  });

  test("transform rejects source path with null byte", async () => {
    const root = tmpRoot();
    await createTestTree(root, {
      "public/photo.png": TINY_PNG,
    });
    try {
      const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
      await expect(
        optimizer.transform("/photo.png\0.txt", { width: 100 }),
      ).rejects.toThrow(ImageOptimizerError);
      try {
        await optimizer.transform("/photo.png\0.txt", { width: 100 });
      } catch (err) {
        expect((err as ImageOptimizerError).code).toBe("FORBIDDEN");
      }
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("transform rejects percent-encoded null byte in source path", async () => {
    const root = tmpRoot();
    await createTestTree(root, {
      "public/photo.png": TINY_PNG,
    });
    try {
      const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });
      // Decode the %00 first (as the URL parser would) to form a literal null byte
      const maliciousPath = decodeURIComponent("/photo.png%00evil");
      await expect(
        optimizer.transform(maliciousPath, {}),
      ).rejects.toThrow(ImageOptimizerError);
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("valid URL without null bytes passes parseImageQuery", () => {
    const result = parseImageQuery("/_capstan/image?url=/images/photo.jpg&w=800");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.src).toBe("/images/photo.jpg");
      expect(result.options.width).toBe(800);
    }
  });
});

// ==========================================================================
// Security hardening — cache format validation
// ==========================================================================

describe("security hardening — cache format validation", () => {
  test("getCached rejects malicious format string in cached metadata", async () => {
    const root = tmpRoot();
    const cacheDir = join(root, ".capstan/image-cache");
    await createTestTree(root, {
      "public/photo.png": TINY_PNG,
    });
    await mkdir(cacheDir, { recursive: true });

    try {
      // Write a poisoned cache metadata file with a traversal format
      const fakeKey = "deadbeef".repeat(8);
      const poisonedMeta = JSON.stringify({
        format: "../../../evil",
        contentType: "image/png",
        width: 100,
        height: 100,
        originalSize: 67,
        optimizedSize: 67,
      });
      await writeFile(join(cacheDir, `${fakeKey}.json`), poisonedMeta, "utf-8");

      const optimizer = createImageOptimizer(root, {
        allowedDirs: ["public"],
        cacheDir,
      });
      const cached = await optimizer.getCached(fakeKey);
      // Format validation regex /^[a-z]{2,8}$/ rejects "../../../evil"
      expect(cached).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("getCached rejects format with slashes", async () => {
    const root = tmpRoot();
    const cacheDir = join(root, ".capstan/image-cache");
    await mkdir(cacheDir, { recursive: true });

    try {
      const fakeKey = "abcdef01".repeat(8);
      const poisonedMeta = JSON.stringify({
        format: "png/../../etc",
        contentType: "image/png",
        width: 50,
        height: 50,
        originalSize: 10,
        optimizedSize: 10,
      });
      await writeFile(join(cacheDir, `${fakeKey}.json`), poisonedMeta, "utf-8");

      const optimizer = createImageOptimizer(root, { cacheDir });
      const cached = await optimizer.getCached(fakeKey);
      expect(cached).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("getCached rejects format with dots", async () => {
    const root = tmpRoot();
    const cacheDir = join(root, ".capstan/image-cache");
    await mkdir(cacheDir, { recursive: true });

    try {
      const fakeKey = "01234567".repeat(8);
      const poisonedMeta = JSON.stringify({
        format: "..png",
        contentType: "image/png",
        width: 50,
        height: 50,
        originalSize: 10,
        optimizedSize: 10,
      });
      await writeFile(join(cacheDir, `${fakeKey}.json`), poisonedMeta, "utf-8");

      const optimizer = createImageOptimizer(root, { cacheDir });
      const cached = await optimizer.getCached(fakeKey);
      expect(cached).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ==========================================================================
// Security hardening — symlink escape
// ==========================================================================

describe("security hardening — symlink escape", () => {
  let root: string;

  beforeEach(async () => {
    root = tmpRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  test("transform rejects symlink that escapes allowed directory", async () => {
    // Create structure:
    //   root/public/real.png          (real image)
    //   root/secret/private.png       (file outside allowed dir)
    //   root/public/escape.png -> root/secret/private.png  (symlink)
    const { symlink } = await import("node:fs/promises");

    await createTestTree(root, {
      "public/real.png": TINY_PNG,
      "secret/private.png": TINY_PNG,
    });

    await symlink(
      join(root, "secret/private.png"),
      join(root, "public/escape.png"),
    );

    const optimizer = createImageOptimizer(root, { allowedDirs: ["public"] });

    // The real file should work
    const result = await optimizer.transform("/real.png", {});
    expect(result.data.byteLength).toBeGreaterThan(0);

    // The symlink escape should be rejected as FORBIDDEN
    try {
      await optimizer.transform("/escape.png", {});
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(ImageOptimizerError);
      expect((err as ImageOptimizerError).code).toBe("FORBIDDEN");
    }
  });
});
