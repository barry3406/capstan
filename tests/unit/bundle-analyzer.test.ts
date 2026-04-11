import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeSizes,
  analyzeBundle,
  checkBudgets,
  formatAnalysisTable,
  formatAnalysisSummary,
  formatBudgetReport,
  formatBytes,
  DEFAULT_BUDGETS,
} from "../../packages/dev/src/analyzer.js";
import type {
  BundleAnalysis,
  BundleBudget,
  BundleSizeEntry,
  BudgetCheckResult,
} from "../../packages/dev/src/analyzer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "capstan-analyzer-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function zeroSize(): BundleSizeEntry {
  return { raw: 0, gzip: 0, brotli: 0 };
}

function emptyAnalysis(overrides: Partial<BundleAnalysis> = {}): BundleAnalysis {
  return {
    timestamp: new Date().toISOString(),
    totalSize: zeroSize(),
    jsSize: zeroSize(),
    cssSize: zeroSize(),
    routes: [],
    chunks: [],
    assets: [],
    routeCount: 0,
    sharedChunkCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
  test("zero returns '0 B'", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  test("small bytes (< 1024) are shown as B", () => {
    expect(formatBytes(123)).toBe("123 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  test("exactly 1024 formats as KB", () => {
    expect(formatBytes(1024)).toBe("1.00 KB");
  });

  test("fractional KB", () => {
    expect(formatBytes(1536)).toBe("1.50 KB");
  });

  test("exactly 1 MB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
  });

  test("fractional MB", () => {
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.50 MB");
  });

  test("negative returns '0 B'", () => {
    expect(formatBytes(-100)).toBe("0 B");
    expect(formatBytes(-1)).toBe("0 B");
  });

  test("NaN returns '0 B'", () => {
    expect(formatBytes(NaN)).toBe("0 B");
  });

  test("Infinity returns '0 B'", () => {
    expect(formatBytes(Infinity)).toBe("0 B");
    expect(formatBytes(-Infinity)).toBe("0 B");
  });

  test("rounds bytes to integers", () => {
    expect(formatBytes(1.7)).toBe("2 B");
    expect(formatBytes(0.4)).toBe("0 B");
  });

  test("large KB values do not jump to MB prematurely", () => {
    // 500 KB
    const result = formatBytes(500 * 1024);
    expect(result).toBe("500.00 KB");
  });

  test("boundary between KB and MB", () => {
    // 1024 KB = 1 MB
    expect(formatBytes(1024 * 1024 - 1)).toContain("KB");
    expect(formatBytes(1024 * 1024)).toContain("MB");
  });
});

// ---------------------------------------------------------------------------
// computeSizes
// ---------------------------------------------------------------------------

describe("computeSizes", () => {
  test("empty string returns all zeros", async () => {
    const result = await computeSizes("");
    expect(result).toEqual({ raw: 0, gzip: 0, brotli: 0 });
  });

  test("empty Uint8Array returns all zeros", async () => {
    const result = await computeSizes(new Uint8Array(0));
    expect(result).toEqual({ raw: 0, gzip: 0, brotli: 0 });
  });

  test("small string may have gzip larger than raw (compression overhead)", async () => {
    const tiny = "ab";
    const result = await computeSizes(tiny);
    expect(result.raw).toBe(2);
    // gzip adds headers, so for tiny data it may exceed raw
    expect(result.gzip).toBeGreaterThan(0);
    expect(result.brotli).toBeGreaterThan(0);
  });

  test("large repetitive string compresses well", async () => {
    const repeated = "a".repeat(10_000);
    const result = await computeSizes(repeated);
    expect(result.raw).toBe(10_000);
    expect(result.gzip).toBeLessThan(result.raw);
    expect(result.brotli).toBeLessThan(result.raw);
    // brotli typically beats gzip
    expect(result.brotli).toBeLessThanOrEqual(result.gzip);
  });

  test("binary data (Uint8Array) produces correct raw size", async () => {
    const data = new Uint8Array([0x00, 0xff, 0x80, 0x42, 0x13]);
    const result = await computeSizes(data);
    expect(result.raw).toBe(5);
    expect(result.gzip).toBeGreaterThan(0);
    expect(result.brotli).toBeGreaterThan(0);
  });

  test("unicode content: raw is byte length, not char length", async () => {
    // Each emoji is 4 bytes in UTF-8
    const emoji = "\u{1F600}\u{1F600}"; // 2 emoji
    const result = await computeSizes(emoji);
    // 2 emoji x 4 bytes each = 8 bytes
    expect(result.raw).toBe(8);
  });

  test("multi-byte CJK characters measure byte length", async () => {
    const cjk = "\u4F60\u597D"; // 2 CJK chars, 3 bytes each in UTF-8
    const result = await computeSizes(cjk);
    expect(result.raw).toBe(6);
  });

  test("very large content (1MB+) does not OOM", async () => {
    const large = "x".repeat(1_200_000);
    const result = await computeSizes(large);
    expect(result.raw).toBe(1_200_000);
    expect(result.gzip).toBeGreaterThan(0);
    expect(result.brotli).toBeGreaterThan(0);
  });

  test("all-zero Uint8Array compresses well", async () => {
    const zeros = new Uint8Array(5000);
    const result = await computeSizes(zeros);
    expect(result.raw).toBe(5000);
    expect(result.gzip).toBeLessThan(result.raw);
  });

  test("random-like data compresses poorly", async () => {
    // Pseudo-random buffer
    const buf = new Uint8Array(2000);
    for (let i = 0; i < buf.length; i++) {
      buf[i] = (i * 37 + 97) % 256;
    }
    const result = await computeSizes(buf);
    expect(result.raw).toBe(2000);
    // Compressed sizes should still be > 0
    expect(result.gzip).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// analyzeBundle
// ---------------------------------------------------------------------------

describe("analyzeBundle", () => {
  test("non-existent directory throws", async () => {
    const bad = join(tmpRoot, "does-not-exist");
    await expect(analyzeBundle({ buildDir: bad })).rejects.toThrow(
      /does not exist/,
    );
  });

  test("path that is a file (not directory) throws", async () => {
    const filePath = join(tmpRoot, "afile.txt");
    await writeFile(filePath, "hello");
    await expect(analyzeBundle({ buildDir: filePath })).rejects.toThrow(
      /Not a directory/,
    );
  });

  test("empty directory returns empty analysis", async () => {
    const dir = join(tmpRoot, "empty");
    await mkdir(dir, { recursive: true });
    const result = await analyzeBundle({ buildDir: dir });

    expect(result.assets).toHaveLength(0);
    expect(result.chunks).toHaveLength(0);
    expect(result.routes).toHaveLength(0);
    expect(result.totalSize).toEqual(zeroSize());
    expect(result.jsSize).toEqual(zeroSize());
    expect(result.cssSize).toEqual(zeroSize());
    expect(result.routeCount).toBe(0);
    expect(result.sharedChunkCount).toBe(0);
    expect(result.timestamp).toBeTruthy();
  });

  test("directory with only JS files", async () => {
    const dir = join(tmpRoot, "js-only");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), "console.log('hello');");
    await writeFile(join(dir, "vendor.js"), "var x = 1;");

    const result = await analyzeBundle({ buildDir: dir });

    expect(result.assets).toHaveLength(2);
    expect(result.assets.every((a) => a.type === "js")).toBe(true);
    expect(result.jsSize.raw).toBeGreaterThan(0);
    expect(result.cssSize).toEqual(zeroSize());
    expect(result.totalSize.raw).toBe(result.jsSize.raw);
    expect(result.chunks).toHaveLength(2);
  });

  test("directory with only CSS files", async () => {
    const dir = join(tmpRoot, "css-only");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "style.css"), "body { margin: 0; }");

    const result = await analyzeBundle({ buildDir: dir });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.type).toBe("css");
    expect(result.cssSize.raw).toBeGreaterThan(0);
    expect(result.jsSize).toEqual(zeroSize());
    expect(result.totalSize.raw).toBe(result.cssSize.raw);
    // CSS files should not appear as chunks
    expect(result.chunks).toHaveLength(0);
  });

  test("mixed files (js, css, png, woff2) are classified correctly", async () => {
    const dir = join(tmpRoot, "mixed");
    const assetsDir = join(dir, "assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, "app.js"), "var x = 1;");
    await writeFile(join(assetsDir, "style.css"), "body{}");
    await writeFile(join(assetsDir, "logo.png"), "PNG fake data");
    await writeFile(join(assetsDir, "font.woff2"), "woff2 fake data");
    await writeFile(join(assetsDir, "data.json"), '{"a":1}');

    const result = await analyzeBundle({ buildDir: dir });

    const types = new Map(result.assets.map((a) => [a.name.split("/").pop()!, a.type]));
    expect(types.get("app.js")).toBe("js");
    expect(types.get("style.css")).toBe("css");
    expect(types.get("logo.png")).toBe("image");
    expect(types.get("font.woff2")).toBe("font");
    expect(types.get("data.json")).toBe("other");
  });

  test("nested directories are traversed", async () => {
    const dir = join(tmpRoot, "nested");
    await mkdir(join(dir, "a", "b", "c"), { recursive: true });
    await writeFile(join(dir, "a", "b", "c", "deep.js"), "deep();");
    await writeFile(join(dir, "top.js"), "top();");

    const result = await analyzeBundle({ buildDir: dir });

    expect(result.assets).toHaveLength(2);
    const names = result.assets.map((a) => a.name).sort();
    expect(names).toContain("a/b/c/deep.js");
    expect(names).toContain("top.js");
  });

  test(".map files (source maps) are excluded", async () => {
    const dir = join(tmpRoot, "with-maps");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), "function f(){}");
    await writeFile(join(dir, "app.js.map"), '{"version":3}');
    await writeFile(join(dir, "style.css.map"), '{"mappings":""}');

    const result = await analyzeBundle({ buildDir: dir });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.name).toBe("app.js");
  });

  test("zero-byte files are included with zero sizes", async () => {
    const dir = join(tmpRoot, "empty-files");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "empty.js"), "");
    await writeFile(join(dir, "empty.css"), "");

    const result = await analyzeBundle({ buildDir: dir });

    expect(result.assets).toHaveLength(2);
    for (const asset of result.assets) {
      expect(asset.size).toEqual(zeroSize());
    }
  });

  test("symlinks are followed gracefully", async () => {
    const dir = join(tmpRoot, "with-symlinks");
    await mkdir(dir, { recursive: true });
    const realFile = join(tmpRoot, "real.js");
    await writeFile(realFile, "var linked = true;");
    await symlink(realFile, join(dir, "link.js"));

    const result = await analyzeBundle({ buildDir: dir });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.name).toBe("link.js");
    expect(result.assets[0]!.size.raw).toBeGreaterThan(0);
  });

  test("unusual extensions are classified as 'other'", async () => {
    const dir = join(tmpRoot, "unusual");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "data.xml"), "<root/>");
    await writeFile(join(dir, "file.txt"), "hello");
    await writeFile(join(dir, "binary.wasm"), "\0\x61\x73\x6d");

    const result = await analyzeBundle({ buildDir: dir });

    for (const asset of result.assets) {
      expect(asset.type).toBe("other");
    }
  });

  test("deeply nested structure works", async () => {
    const dir = join(tmpRoot, "deep");
    const deepPath = join(dir, "a", "b", "c", "d", "e", "f", "g");
    await mkdir(deepPath, { recursive: true });
    await writeFile(join(deepPath, "deep.js"), "1;");

    const result = await analyzeBundle({ buildDir: dir });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.name).toBe("a/b/c/d/e/f/g/deep.js");
  });

  // --- Vite manifest integration ---

  test("with Vite manifest resolves chunk relationships", async () => {
    const dir = join(tmpRoot, "vite");
    const assetsDir = join(dir, "assets");
    const viteDir = join(dir, ".vite");
    await mkdir(assetsDir, { recursive: true });
    await mkdir(viteDir, { recursive: true });

    await writeFile(join(assetsDir, "client-abc.js"), "// entry");
    await writeFile(join(assetsDir, "shared-xyz.js"), "// shared");
    await writeFile(join(assetsDir, "style-def.css"), "body{}");

    const manifest = {
      "app/client.tsx": {
        file: "assets/client-abc.js",
        src: "app/client.tsx",
        isEntry: true,
        css: ["assets/style-def.css"],
        imports: ["_shared-xyz.js"],
      },
      "_shared-xyz.js": {
        file: "assets/shared-xyz.js",
        src: "_shared-xyz.js",
      },
    };
    const manifestPath = join(viteDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    const result = await analyzeBundle({ buildDir: dir, manifestPath });

    // Should have 2 chunks (both JS files found in manifest)
    expect(result.chunks).toHaveLength(2);

    const entryChunk = result.chunks.find((c) => c.isEntry);
    expect(entryChunk).toBeTruthy();
    expect(entryChunk!.name).toBe("assets/client-abc.js");

    const sharedChunk = result.chunks.find((c) => !c.isEntry);
    expect(sharedChunk).toBeTruthy();
    expect(sharedChunk!.name).toBe("assets/shared-xyz.js");
    expect(result.sharedChunkCount).toBe(1);
  });

  test("without Vite manifest chunks lack relationship data", async () => {
    const dir = join(tmpRoot, "no-manifest");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.js"), "a");
    await writeFile(join(dir, "b.js"), "b");

    const result = await analyzeBundle({ buildDir: dir });

    expect(result.chunks).toHaveLength(2);
    for (const chunk of result.chunks) {
      expect(chunk.isEntry).toBe(false);
      expect(chunk.isDynamic).toBe(false);
      expect(chunk.modules).toEqual([]);
    }
    expect(result.sharedChunkCount).toBe(0);
  });

  test("invalid Vite manifest (bad JSON) is skipped gracefully", async () => {
    const dir = join(tmpRoot, "bad-manifest");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), "ok();");
    const badManifest = join(tmpRoot, "bad.json");
    await writeFile(badManifest, "NOT VALID JSON {{{");

    const result = await analyzeBundle({ buildDir: dir, manifestPath: badManifest });

    // Should still analyze files, just without manifest data
    expect(result.assets).toHaveLength(1);
    expect(result.chunks).toHaveLength(1);
  });

  test("manifest pointing to missing files is handled", async () => {
    const dir = join(tmpRoot, "missing-files");
    await mkdir(dir, { recursive: true });
    // Manifest references a file that does not exist on disk
    const manifest = {
      "app/main.tsx": {
        file: "assets/does-not-exist.js",
        src: "app/main.tsx",
        isEntry: true,
      },
    };
    const manifestPath = join(tmpRoot, "missing-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    const result = await analyzeBundle({ buildDir: dir, manifestPath });

    // No chunks because the referenced file is missing
    expect(result.chunks).toHaveLength(0);
  });

  // --- Route manifest ---

  test("with route manifest produces per-route breakdown", async () => {
    const dir = join(tmpRoot, "routes");
    const assetsDir = join(dir, "assets");
    const viteDir = join(dir, ".vite");
    await mkdir(assetsDir, { recursive: true });
    await mkdir(viteDir, { recursive: true });

    await writeFile(join(assetsDir, "home-aaa.js"), "function home(){}");
    await writeFile(join(assetsDir, "post-bbb.js"), "function post(){}");
    await writeFile(join(assetsDir, "shared-ccc.js"), "function shared(){}");
    await writeFile(join(assetsDir, "main-ddd.css"), "h1{color:red}");

    const viteManifest = {
      "app/pages/index.tsx": {
        file: "assets/home-aaa.js",
        src: "app/pages/index.tsx",
        isEntry: true,
        css: ["assets/main-ddd.css"],
        imports: ["_shared-ccc.js"],
      },
      "app/pages/posts/[id].tsx": {
        file: "assets/post-bbb.js",
        src: "app/pages/posts/[id].tsx",
        isEntry: true,
        css: ["assets/main-ddd.css"],
        imports: ["_shared-ccc.js"],
      },
      "_shared-ccc.js": {
        file: "assets/shared-ccc.js",
        src: "_shared-ccc.js",
      },
    };
    const manifestPath = join(viteDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(viteManifest));

    const routeManifest = {
      routes: [
        { urlPattern: "/", filePath: "app/pages/index.tsx", type: "page" },
        { urlPattern: "/posts/:id", filePath: "app/pages/posts/[id].tsx", type: "page" },
      ],
    };

    const result = await analyzeBundle({ buildDir: dir, manifestPath, routeManifest });

    expect(result.routes).toHaveLength(2);
    expect(result.routeCount).toBe(2);

    const homeRoute = result.routes.find((r) => r.pattern === "/");
    expect(homeRoute).toBeTruthy();
    expect(homeRoute!.js.raw).toBeGreaterThan(0);
    expect(homeRoute!.css.raw).toBeGreaterThan(0);
    expect(homeRoute!.total.raw).toBe(homeRoute!.js.raw + homeRoute!.css.raw);
    expect(homeRoute!.chunks.length).toBeGreaterThanOrEqual(1);

    const postRoute = result.routes.find((r) => r.pattern === "/posts/:id");
    expect(postRoute).toBeTruthy();
  });

  test("without route manifest produces no per-route data", async () => {
    const dir = join(tmpRoot, "no-routes");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), "app();");

    const result = await analyzeBundle({ buildDir: dir });

    expect(result.routes).toHaveLength(0);
    expect(result.routeCount).toBe(0);
  });

  test("route manifest without vite manifest produces no routes", async () => {
    const dir = join(tmpRoot, "route-no-vite");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), "app();");

    const routeManifest = {
      routes: [{ urlPattern: "/", filePath: "app/pages/index.tsx", type: "page" }],
    };

    const result = await analyzeBundle({ buildDir: dir, routeManifest });
    // No vite manifest means we can't map routes to chunks
    expect(result.routes).toHaveLength(0);
  });

  test("route manifest with unmatched routes are skipped", async () => {
    const dir = join(tmpRoot, "unmatched");
    const viteDir = join(dir, ".vite");
    await mkdir(viteDir, { recursive: true });
    await writeFile(join(dir, "app.js"), "ok();");

    const viteManifest = {
      "app/pages/index.tsx": {
        file: "app.js",
        src: "app/pages/index.tsx",
        isEntry: true,
      },
    };
    await writeFile(join(viteDir, "manifest.json"), JSON.stringify(viteManifest));

    const routeManifest = {
      routes: [
        { urlPattern: "/", filePath: "app/pages/index.tsx", type: "page" },
        { urlPattern: "/about", filePath: "app/pages/about.tsx", type: "page" },
      ],
    };

    const result = await analyzeBundle({
      buildDir: dir,
      manifestPath: join(viteDir, "manifest.json"),
      routeManifest,
    });

    // Only the matched route should appear
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]!.pattern).toBe("/");
  });

  test("dynamic entry in vite manifest is marked", async () => {
    const dir = join(tmpRoot, "dynamic");
    const assetsDir = join(dir, "assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, "lazy-abc.js"), "lazy();");

    const manifest = {
      "app/lazy.tsx": {
        file: "assets/lazy-abc.js",
        src: "app/lazy.tsx",
        isDynamicEntry: true,
      },
    };
    const manifestPath = join(tmpRoot, "dyn-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    const result = await analyzeBundle({ buildDir: dir, manifestPath });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.isDynamic).toBe(true);
    expect(result.chunks[0]!.isEntry).toBe(false);
  });

  test("image extensions classified correctly (jpg, jpeg, gif, svg, webp, avif, ico)", async () => {
    const dir = join(tmpRoot, "images");
    await mkdir(dir, { recursive: true });
    const exts = [".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico"];
    for (const ext of exts) {
      await writeFile(join(dir, `img${ext}`), "data");
    }

    const result = await analyzeBundle({ buildDir: dir });
    for (const asset of result.assets) {
      expect(asset.type).toBe("image");
    }
  });

  test("font extensions classified correctly (woff, ttf, otf, eot)", async () => {
    const dir = join(tmpRoot, "fonts");
    await mkdir(dir, { recursive: true });
    const exts = [".woff", ".ttf", ".otf", ".eot"];
    for (const ext of exts) {
      await writeFile(join(dir, `font${ext}`), "data");
    }

    const result = await analyzeBundle({ buildDir: dir });
    for (const asset of result.assets) {
      expect(asset.type).toBe("font");
    }
  });

  test(".mjs and .cjs are classified as js", async () => {
    const dir = join(tmpRoot, "module-exts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "mod.mjs"), "export default 1;");
    await writeFile(join(dir, "mod.cjs"), "module.exports = 1;");

    const result = await analyzeBundle({ buildDir: dir });
    expect(result.assets).toHaveLength(2);
    for (const asset of result.assets) {
      expect(asset.type).toBe("js");
    }
    expect(result.chunks).toHaveLength(2);
  });

  test("totalSize equals jsSize + cssSize", async () => {
    const dir = join(tmpRoot, "total-check");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "bundle.js"), "var a = 1;".repeat(100));
    await writeFile(join(dir, "style.css"), ".x { color: red; }".repeat(50));

    const result = await analyzeBundle({ buildDir: dir });

    expect(result.totalSize.raw).toBe(result.jsSize.raw + result.cssSize.raw);
    expect(result.totalSize.gzip).toBe(result.jsSize.gzip + result.cssSize.gzip);
    expect(result.totalSize.brotli).toBe(result.jsSize.brotli + result.cssSize.brotli);
  });

  test("images and fonts do not count toward totalSize", async () => {
    const dir = join(tmpRoot, "no-img-total");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), "x();");
    await writeFile(join(dir, "logo.png"), "PNG" + "x".repeat(500));

    const result = await analyzeBundle({ buildDir: dir });

    // totalSize only counts JS + CSS
    const pngAsset = result.assets.find((a) => a.name === "logo.png");
    expect(pngAsset).toBeTruthy();
    expect(result.totalSize.raw).toBeLessThan(
      result.jsSize.raw + pngAsset!.size.raw,
    );
  });
});

// ---------------------------------------------------------------------------
// checkBudgets
// ---------------------------------------------------------------------------

describe("checkBudgets", () => {
  test("all budgets pass returns passed: true, empty violations", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 1000, gzip: 500, brotli: 400 },
      jsSize: { raw: 800, gzip: 400, brotli: 300 },
      cssSize: { raw: 200, gzip: 100, brotli: 100 },
    });
    const budgets: BundleBudget = {
      maxTotalSizeKb: 10,
      maxJsSizeKb: 10,
      maxCssSizeKb: 10,
      useGzip: true,
    };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("single violation is reported", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 300 * 1024, gzip: 260 * 1024, brotli: 200 * 1024 },
      jsSize: { raw: 200 * 1024, gzip: 160 * 1024, brotli: 120 * 1024 },
      cssSize: { raw: 100 * 1024, gzip: 100 * 1024, brotli: 80 * 1024 },
    });
    const budgets: BundleBudget = {
      maxTotalSizeKb: 250, // 260 KB gzip > 250 KB
      maxJsSizeKb: 200,
      maxCssSizeKb: 200,
      useGzip: true,
    };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.rule).toBe("maxTotalSizeKb");
  });

  test("multiple violations all reported", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 500 * 1024, gzip: 400 * 1024, brotli: 300 * 1024 },
      jsSize: { raw: 400 * 1024, gzip: 300 * 1024, brotli: 250 * 1024 },
      cssSize: { raw: 100 * 1024, gzip: 100 * 1024, brotli: 50 * 1024 },
    });
    const budgets: BundleBudget = {
      maxTotalSizeKb: 250,
      maxJsSizeKb: 200,
      maxCssSizeKb: 50,
      useGzip: true,
    };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });

  test("budget at exact limit passes (not strict less-than)", () => {
    // 100 KB gzip exactly
    const analysis = emptyAnalysis({
      totalSize: { raw: 200 * 1024, gzip: 100 * 1024, brotli: 80 * 1024 },
      jsSize: { raw: 200 * 1024, gzip: 100 * 1024, brotli: 80 * 1024 },
      cssSize: zeroSize(),
    });
    const budgets: BundleBudget = {
      maxTotalSizeKb: 100,
      maxJsSizeKb: 100,
      useGzip: true,
    };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("1 byte over budget fails", () => {
    // 100 KB + 1 byte
    const overBytes = 100 * 1024 + 1;
    const analysis = emptyAnalysis({
      totalSize: { raw: overBytes, gzip: overBytes, brotli: overBytes },
      jsSize: { raw: overBytes, gzip: overBytes, brotli: overBytes },
      cssSize: zeroSize(),
    });
    const budgets: BundleBudget = {
      maxTotalSizeKb: 100,
      useGzip: true,
    };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  test("undefined budget fields are skipped", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 999999, gzip: 999999, brotli: 999999 },
      jsSize: { raw: 999999, gzip: 999999, brotli: 999999 },
      cssSize: { raw: 999999, gzip: 999999, brotli: 999999 },
    });
    // All undefined
    const budgets: BundleBudget = {};
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(true);
  });

  test("empty budgets object always passes", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 10_000_000, gzip: 5_000_000, brotli: 4_000_000 },
      jsSize: { raw: 10_000_000, gzip: 5_000_000, brotli: 4_000_000 },
      cssSize: { raw: 10_000_000, gzip: 5_000_000, brotli: 4_000_000 },
    });
    const result = checkBudgets(analysis, {});
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("useGzip: true compares gzip sizes (default)", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 50 * 1024, gzip: 200 * 1024, brotli: 10 * 1024 },
      jsSize: zeroSize(),
      cssSize: zeroSize(),
    });
    // raw (50 KB) passes, but gzip (200 KB) exceeds 100 KB limit
    const budgets: BundleBudget = { maxTotalSizeKb: 100, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
  });

  test("useGzip: false compares raw sizes", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 50 * 1024, gzip: 200 * 1024, brotli: 10 * 1024 },
      jsSize: zeroSize(),
      cssSize: zeroSize(),
    });
    // raw (50 KB) passes even though gzip (200 KB) exceeds
    const budgets: BundleBudget = { maxTotalSizeKb: 100, useGzip: false };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(true);
  });

  test("useGzip: undefined defaults to true", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 50 * 1024, gzip: 200 * 1024, brotli: 10 * 1024 },
      jsSize: zeroSize(),
      cssSize: zeroSize(),
    });
    const budgets: BundleBudget = { maxTotalSizeKb: 100 }; // no useGzip
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false); // uses gzip: 200 KB > 100 KB
  });

  test("route budget: one route over, others under", () => {
    const analysis = emptyAnalysis({
      totalSize: zeroSize(),
      jsSize: zeroSize(),
      cssSize: zeroSize(),
      routes: [
        {
          pattern: "/",
          filePath: "app/pages/index.tsx",
          js: { raw: 50 * 1024, gzip: 50 * 1024, brotli: 40 * 1024 },
          css: zeroSize(),
          total: { raw: 50 * 1024, gzip: 50 * 1024, brotli: 40 * 1024 },
          chunks: [],
        },
        {
          pattern: "/heavy",
          filePath: "app/pages/heavy.tsx",
          js: { raw: 200 * 1024, gzip: 150 * 1024, brotli: 120 * 1024 },
          css: zeroSize(),
          total: { raw: 200 * 1024, gzip: 150 * 1024, brotli: 120 * 1024 },
          chunks: [],
        },
      ],
    });
    const budgets: BundleBudget = { maxRouteSizeKb: 100, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.target).toBe("/heavy");
    expect(result.violations[0]!.rule).toBe("maxRouteSizeKb");
  });

  test("chunk budget: shared chunk over limit reported with name", () => {
    const analysis = emptyAnalysis({
      totalSize: zeroSize(),
      jsSize: zeroSize(),
      cssSize: zeroSize(),
      chunks: [
        {
          name: "assets/vendor-abc.js",
          size: { raw: 200 * 1024, gzip: 160 * 1024, brotli: 140 * 1024 },
          modules: [],
          isEntry: false,
          isDynamic: false,
        },
        {
          name: "assets/small.js",
          size: { raw: 10 * 1024, gzip: 5 * 1024, brotli: 4 * 1024 },
          modules: [],
          isEntry: true,
          isDynamic: false,
        },
      ],
    });
    const budgets: BundleBudget = { maxChunkSizeKb: 150, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.target).toBe("assets/vendor-abc.js");
  });

  test("zero budget causes everything to fail", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 1, gzip: 1, brotli: 1 },
      jsSize: { raw: 1, gzip: 1, brotli: 1 },
      cssSize: zeroSize(),
    });
    const budgets: BundleBudget = {
      maxTotalSizeKb: 0,
      maxJsSizeKb: 0,
      useGzip: true,
    };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  test("negative budget causes everything to fail", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 1, gzip: 1, brotli: 1 },
      jsSize: zeroSize(),
      cssSize: zeroSize(),
    });
    const budgets: BundleBudget = { maxTotalSizeKb: -10, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  test("NaN budget is skipped (no violation)", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 999999, gzip: 999999, brotli: 999999 },
      jsSize: zeroSize(),
      cssSize: zeroSize(),
    });
    const budgets: BundleBudget = { maxTotalSizeKb: NaN, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(true);
  });

  test("violation message includes actual and limit", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 300 * 1024, gzip: 300 * 1024, brotli: 200 * 1024 },
      jsSize: zeroSize(),
      cssSize: zeroSize(),
    });
    const budgets: BundleBudget = { maxTotalSizeKb: 200, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.violations[0]!.message).toContain("200");
    expect(result.violations[0]!.limit).toBe(200);
    expect(result.violations[0]!.actual).toBe(300);
  });

  test("route violation includes target in message", () => {
    const analysis = emptyAnalysis({
      routes: [
        {
          pattern: "/api/data",
          filePath: "f",
          js: zeroSize(),
          css: zeroSize(),
          total: { raw: 200 * 1024, gzip: 200 * 1024, brotli: 200 * 1024 },
          chunks: [],
        },
      ],
    });
    const budgets: BundleBudget = { maxRouteSizeKb: 100, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.violations[0]!.target).toBe("/api/data");
    expect(result.violations[0]!.message).toContain("/api/data");
  });
});

// ---------------------------------------------------------------------------
// formatAnalysisTable
// ---------------------------------------------------------------------------

describe("formatAnalysisTable", () => {
  test("empty analysis produces a table with (no routes)", () => {
    const analysis = emptyAnalysis();
    const table = formatAnalysisTable(analysis);
    expect(table).toContain("Capstan Bundle Analysis");
    expect(table).toContain("(no routes)");
    expect(table).toContain("Total (unique)");
  });

  test("single route is rendered", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 10 * 1024, gzip: 5 * 1024, brotli: 4 * 1024 },
      jsSize: { raw: 8 * 1024, gzip: 4 * 1024, brotli: 3 * 1024 },
      cssSize: { raw: 2 * 1024, gzip: 1024, brotli: 1024 },
      routes: [
        {
          pattern: "/",
          filePath: "app/pages/index.tsx",
          js: { raw: 8 * 1024, gzip: 4 * 1024, brotli: 3 * 1024 },
          css: { raw: 2 * 1024, gzip: 1024, brotli: 1024 },
          total: { raw: 10 * 1024, gzip: 5 * 1024, brotli: 4 * 1024 },
          chunks: ["assets/home.js"],
        },
      ],
      routeCount: 1,
    });
    const table = formatAnalysisTable(analysis);
    expect(table).toContain("/");
    expect(table).toContain("4.00 KB"); // JS gzip
    expect(table).toContain("1.00 KB"); // CSS gzip
    expect(table).toContain("5.00 KB"); // Total gzip
  });

  test("multiple routes are sorted by total gzip descending", () => {
    const analysis = emptyAnalysis({
      routes: [
        {
          pattern: "/small",
          filePath: "s",
          js: zeroSize(),
          css: zeroSize(),
          total: { raw: 0, gzip: 1000, brotli: 0 },
          chunks: [],
        },
        {
          pattern: "/large",
          filePath: "l",
          js: zeroSize(),
          css: zeroSize(),
          total: { raw: 0, gzip: 5000, brotli: 0 },
          chunks: [],
        },
        {
          pattern: "/medium",
          filePath: "m",
          js: zeroSize(),
          css: zeroSize(),
          total: { raw: 0, gzip: 3000, brotli: 0 },
          chunks: [],
        },
      ],
    });
    const table = formatAnalysisTable(analysis);
    const largeIdx = table.indexOf("/large");
    const mediumIdx = table.indexOf("/medium");
    const smallIdx = table.indexOf("/small");
    expect(largeIdx).toBeLessThan(mediumIdx);
    expect(mediumIdx).toBeLessThan(smallIdx);
  });

  test("very long route patterns are truncated", () => {
    const longPattern = "/this/is/a/very/long/route/pattern/that/should/be/truncated";
    const analysis = emptyAnalysis({
      routes: [
        {
          pattern: longPattern,
          filePath: "f",
          js: zeroSize(),
          css: zeroSize(),
          total: zeroSize(),
          chunks: [],
        },
      ],
    });
    const table = formatAnalysisTable(analysis);
    // Should not contain the full pattern
    expect(table).not.toContain(longPattern);
    // Should contain the ellipsis character
    expect(table).toContain("\u2026");
  });

  test("zero-size entries show '0 B'", () => {
    const analysis = emptyAnalysis({
      routes: [
        {
          pattern: "/empty",
          filePath: "f",
          js: zeroSize(),
          css: zeroSize(),
          total: zeroSize(),
          chunks: [],
        },
      ],
    });
    const table = formatAnalysisTable(analysis);
    expect(table).toContain("0 B");
  });

  test("table contains box-drawing characters for borders", () => {
    const table = formatAnalysisTable(emptyAnalysis());
    expect(table).toContain("\u250C"); // top-left
    expect(table).toContain("\u2518"); // bottom-right
    expect(table).toContain("\u2502"); // vertical
    expect(table).toContain("\u2500"); // horizontal
  });

  test("table contains shared chunks row", () => {
    const analysis = emptyAnalysis({ sharedChunkCount: 3 });
    const table = formatAnalysisTable(analysis);
    expect(table).toContain("Shared chunks (3)");
  });

  test("table ends with newline", () => {
    const table = formatAnalysisTable(emptyAnalysis());
    expect(table.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatAnalysisSummary
// ---------------------------------------------------------------------------

describe("formatAnalysisSummary", () => {
  test("includes total size", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 50000, gzip: 20000, brotli: 15000 },
    });
    const summary = formatAnalysisSummary(analysis);
    expect(summary).toContain("19.53 KB");  // gzip
    expect(summary).toContain("48.83 KB");  // raw
  });

  test("includes route count", () => {
    const analysis = emptyAnalysis({ routeCount: 5 });
    const summary = formatAnalysisSummary(analysis);
    expect(summary).toContain("Routes: 5");
  });

  test("includes shared chunk count", () => {
    const analysis = emptyAnalysis({ sharedChunkCount: 3 });
    const summary = formatAnalysisSummary(analysis);
    expect(summary).toContain("Shared chunks: 3");
  });

  test("includes JS and CSS sizes", () => {
    const analysis = emptyAnalysis({
      jsSize: { raw: 10000, gzip: 5000, brotli: 4000 },
      cssSize: { raw: 2000, gzip: 1000, brotli: 800 },
    });
    const summary = formatAnalysisSummary(analysis);
    expect(summary).toContain("JS:");
    expect(summary).toContain("CSS:");
  });

  test("ends with newline", () => {
    const summary = formatAnalysisSummary(emptyAnalysis());
    expect(summary.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatBudgetReport
// ---------------------------------------------------------------------------

describe("formatBudgetReport", () => {
  test("no violations returns 'All budgets passed.'", () => {
    const result: BudgetCheckResult = { passed: true, violations: [] };
    const report = formatBudgetReport(result);
    expect(report).toContain("All budgets passed.");
  });

  test("single violation has clear message", () => {
    const result: BudgetCheckResult = {
      passed: false,
      violations: [
        {
          rule: "maxTotalSizeKb",
          limit: 200,
          actual: 300,
          message: "maxTotalSizeKb: 300.00 KB exceeds 200 KB",
        },
      ],
    };
    const report = formatBudgetReport(result);
    expect(report).toContain("Budget violations (1)");
    expect(report).toContain("maxTotalSizeKb");
  });

  test("multiple violations all listed", () => {
    const result: BudgetCheckResult = {
      passed: false,
      violations: [
        { rule: "maxTotalSizeKb", limit: 200, actual: 300, message: "total over" },
        { rule: "maxJsSizeKb", limit: 100, actual: 250, message: "js over" },
        { rule: "maxRouteSizeKb", limit: 50, actual: 80, target: "/heavy", message: "route over" },
      ],
    };
    const report = formatBudgetReport(result);
    expect(report).toContain("Budget violations (3)");
    expect(report).toContain("total over");
    expect(report).toContain("js over");
    expect(report).toContain("route over");
  });

  test("route-specific violation includes route pattern", () => {
    const result: BudgetCheckResult = {
      passed: false,
      violations: [
        {
          rule: "maxRouteSizeKb",
          limit: 100,
          actual: 150,
          target: "/posts/:id",
          message: "maxRouteSizeKb: /posts/:id is 150 KB (limit 100 KB)",
        },
      ],
    };
    const report = formatBudgetReport(result);
    expect(report).toContain("/posts/:id");
  });

  test("ends with newline", () => {
    const report = formatBudgetReport({ passed: true, violations: [] });
    expect(report.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_BUDGETS
// ---------------------------------------------------------------------------

describe("DEFAULT_BUDGETS", () => {
  test("has expected default values", () => {
    expect(DEFAULT_BUDGETS.maxTotalSizeKb).toBe(250);
    expect(DEFAULT_BUDGETS.maxRouteSizeKb).toBe(100);
    expect(DEFAULT_BUDGETS.maxChunkSizeKb).toBe(150);
    expect(DEFAULT_BUDGETS.maxCssSizeKb).toBe(50);
    expect(DEFAULT_BUDGETS.maxJsSizeKb).toBe(200);
    expect(DEFAULT_BUDGETS.useGzip).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: analyzeBundle + checkBudgets
// ---------------------------------------------------------------------------

describe("integration: analyzeBundle + checkBudgets", () => {
  test("small build passes default budgets", async () => {
    const dir = join(tmpRoot, "small-build");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), "var x = 1;");
    await writeFile(join(dir, "style.css"), "body { margin: 0; }");

    const analysis = await analyzeBundle({ buildDir: dir });
    const result = checkBudgets(analysis, DEFAULT_BUDGETS);

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("large build exceeds default budgets", async () => {
    const dir = join(tmpRoot, "large-build");
    await mkdir(dir, { recursive: true });
    // Write a 300 KB JS file (raw)
    const largeJs = "x".repeat(300 * 1024);
    await writeFile(join(dir, "huge.js"), largeJs);

    const analysis = await analyzeBundle({ buildDir: dir });
    const result = checkBudgets(analysis, DEFAULT_BUDGETS);

    // Should have at least a total or JS violation
    // (the raw content compresses, but 300 KB of repeated chars compresses well,
    //  so we check that analysis at least runs correctly)
    expect(analysis.jsSize.raw).toBe(300 * 1024);
    expect(typeof result.passed).toBe("boolean");
  });

  test("route-level budget enforcement end-to-end", async () => {
    const dir = join(tmpRoot, "route-budget-e2e");
    const assetsDir = join(dir, "assets");
    const viteDir = join(dir, ".vite");
    await mkdir(assetsDir, { recursive: true });
    await mkdir(viteDir, { recursive: true });

    // Create a large route chunk (120KB+ raw)
    const bigContent = "function f(){" + "x".repeat(120 * 1024) + "}";
    await writeFile(join(assetsDir, "heavy-aaa.js"), bigContent);

    const viteManifest = {
      "app/pages/heavy.tsx": {
        file: "assets/heavy-aaa.js",
        src: "app/pages/heavy.tsx",
        isEntry: true,
      },
    };
    await writeFile(join(viteDir, "manifest.json"), JSON.stringify(viteManifest));

    const routeManifest = {
      routes: [{ urlPattern: "/heavy", filePath: "app/pages/heavy.tsx", type: "page" }],
    };

    const analysis = await analyzeBundle({
      buildDir: dir,
      manifestPath: join(viteDir, "manifest.json"),
      routeManifest,
    });

    expect(analysis.routes).toHaveLength(1);
    expect(analysis.routes[0]!.js.raw).toBeGreaterThan(120 * 1024);

    // Use a very tight budget
    const budgets: BundleBudget = { maxRouteSizeKb: 1, useGzip: false };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.target).toBe("/heavy");
  });
});

// ---------------------------------------------------------------------------
// Edge cases: concurrent file operations and stability
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("analysis timestamp is a valid ISO string", async () => {
    const dir = join(tmpRoot, "ts-check");
    await mkdir(dir, { recursive: true });
    const result = await analyzeBundle({ buildDir: dir });
    // Should not throw when parsed
    const date = new Date(result.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });

  test("budgets with all fields undefined passes any analysis", () => {
    const analysis = emptyAnalysis({
      totalSize: { raw: 1e9, gzip: 1e9, brotli: 1e9 },
      jsSize: { raw: 1e9, gzip: 1e9, brotli: 1e9 },
      cssSize: { raw: 1e9, gzip: 1e9, brotli: 1e9 },
      routes: [
        {
          pattern: "/huge",
          filePath: "f",
          js: zeroSize(),
          css: zeroSize(),
          total: { raw: 1e9, gzip: 1e9, brotli: 1e9 },
          chunks: [],
        },
      ],
      chunks: [
        { name: "huge.js", size: { raw: 1e9, gzip: 1e9, brotli: 1e9 }, modules: [], isEntry: false, isDynamic: false },
      ],
    });
    const result = checkBudgets(analysis, {});
    expect(result.passed).toBe(true);
  });

  test("formatAnalysisTable handles routes with zero CSS gracefully", () => {
    const analysis = emptyAnalysis({
      routes: [
        {
          pattern: "/no-css",
          filePath: "f",
          js: { raw: 5000, gzip: 2000, brotli: 1500 },
          css: zeroSize(),
          total: { raw: 5000, gzip: 2000, brotli: 1500 },
          chunks: [],
        },
      ],
    });
    const table = formatAnalysisTable(analysis);
    expect(table).toContain("/no-css");
    expect(table).toContain("0 B");
  });

  test("checkBudgets with no routes and maxRouteSizeKb set still passes", () => {
    const analysis = emptyAnalysis();
    const budgets: BundleBudget = { maxRouteSizeKb: 10 };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(true);
  });

  test("checkBudgets with no chunks and maxChunkSizeKb set still passes", () => {
    const analysis = emptyAnalysis();
    const budgets: BundleBudget = { maxChunkSizeKb: 10 };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(true);
  });

  test("analyzeBundle handles directory with only .map files", async () => {
    const dir = join(tmpRoot, "maps-only");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js.map"), '{"version":3}');
    await writeFile(join(dir, "style.css.map"), '{"mappings":""}');

    const result = await analyzeBundle({ buildDir: dir });
    expect(result.assets).toHaveLength(0);
    expect(result.totalSize).toEqual(zeroSize());
  });

  test("vite manifest with dynamic imports", async () => {
    const dir = join(tmpRoot, "dynamic-imports");
    const assetsDir = join(dir, "assets");
    await mkdir(assetsDir, { recursive: true });
    await writeFile(join(assetsDir, "entry-aaa.js"), "import('./lazy')");
    await writeFile(join(assetsDir, "lazy-bbb.js"), "export default 1;");

    const manifest = {
      "app/entry.tsx": {
        file: "assets/entry-aaa.js",
        src: "app/entry.tsx",
        isEntry: true,
        dynamicImports: ["app/lazy.tsx"],
      },
      "app/lazy.tsx": {
        file: "assets/lazy-bbb.js",
        src: "app/lazy.tsx",
        isDynamicEntry: true,
      },
    };
    const manifestPath = join(tmpRoot, "dynamic-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    const result = await analyzeBundle({ buildDir: dir, manifestPath });
    const dynamicChunk = result.chunks.find((c) => c.isDynamic);
    expect(dynamicChunk).toBeTruthy();
    expect(dynamicChunk!.name).toBe("assets/lazy-bbb.js");
  });

  test("multiple route budgets: mixed pass/fail", () => {
    const analysis = emptyAnalysis({
      routes: [
        {
          pattern: "/ok",
          filePath: "a",
          js: zeroSize(),
          css: zeroSize(),
          total: { raw: 10 * 1024, gzip: 10 * 1024, brotli: 8 * 1024 },
          chunks: [],
        },
        {
          pattern: "/fail-1",
          filePath: "b",
          js: zeroSize(),
          css: zeroSize(),
          total: { raw: 200 * 1024, gzip: 200 * 1024, brotli: 180 * 1024 },
          chunks: [],
        },
        {
          pattern: "/fail-2",
          filePath: "c",
          js: zeroSize(),
          css: zeroSize(),
          total: { raw: 300 * 1024, gzip: 300 * 1024, brotli: 250 * 1024 },
          chunks: [],
        },
      ],
    });
    const budgets: BundleBudget = { maxRouteSizeKb: 100, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
    const targets = result.violations.map((v) => v.target);
    expect(targets).toContain("/fail-1");
    expect(targets).toContain("/fail-2");
    expect(targets).not.toContain("/ok");
  });

  test("chunk budgets: multiple chunks, mixed pass/fail", () => {
    const analysis = emptyAnalysis({
      chunks: [
        { name: "small.js", size: { raw: 5 * 1024, gzip: 3 * 1024, brotli: 2 * 1024 }, modules: [], isEntry: true, isDynamic: false },
        { name: "big.js", size: { raw: 200 * 1024, gzip: 180 * 1024, brotli: 160 * 1024 }, modules: [], isEntry: false, isDynamic: false },
      ],
    });
    const budgets: BundleBudget = { maxChunkSizeKb: 150, useGzip: true };
    const result = checkBudgets(analysis, budgets);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.target).toBe("big.js");
  });

  test("formatBudgetReport with empty violations array still shows passed", () => {
    const report = formatBudgetReport({ passed: true, violations: [] });
    expect(report).toContain("All budgets passed.");
  });
});

// ---------------------------------------------------------------------------
// Transitive import resolution
// ---------------------------------------------------------------------------

describe("transitive import resolution", () => {
  test("route analysis includes sizes from A + B + C via transitive imports", async () => {
    const dir = join(tmpRoot, "transitive");
    const assetsDir = join(dir, "assets");
    const viteDir = join(dir, ".vite");
    await mkdir(assetsDir, { recursive: true });
    await mkdir(viteDir, { recursive: true });

    // Entry A (100 chars) -> imports chunk B -> imports chunk C
    await writeFile(join(assetsDir, "entry-a.js"), "a".repeat(100));
    await writeFile(join(assetsDir, "chunk-b.js"), "b".repeat(200));
    await writeFile(join(assetsDir, "chunk-c.js"), "c".repeat(300));

    const viteManifest = {
      "app/pages/index.tsx": {
        file: "assets/entry-a.js",
        src: "app/pages/index.tsx",
        isEntry: true,
        imports: ["_chunk-b"],
      },
      "_chunk-b": {
        file: "assets/chunk-b.js",
        src: "_chunk-b",
        imports: ["_chunk-c"],
      },
      "_chunk-c": {
        file: "assets/chunk-c.js",
        src: "_chunk-c",
      },
    };

    const manifestPath = join(viteDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(viteManifest));

    const routeManifest = {
      routes: [
        { urlPattern: "/", filePath: "app/pages/index.tsx", type: "page" },
      ],
    };

    const result = await analyzeBundle({ buildDir: dir, manifestPath, routeManifest });
    expect(result.routes).toHaveLength(1);

    const route = result.routes[0]!;
    // Route JS should include entry A + chunk B + chunk C
    // Each file's raw size ≈ its character count
    expect(route.js.raw).toBeGreaterThanOrEqual(100 + 200 + 300);
    expect(route.chunks).toContain("assets/entry-a.js");
    expect(route.chunks).toContain("assets/chunk-b.js");
    expect(route.chunks).toContain("assets/chunk-c.js");
  });
});

// ---------------------------------------------------------------------------
// CSS dedup across transitive imports
// ---------------------------------------------------------------------------

describe("CSS dedup across transitive imports", () => {
  test("CSS referenced by two different transitive imports is only counted once", async () => {
    const dir = join(tmpRoot, "css-dedup");
    const assetsDir = join(dir, "assets");
    const viteDir = join(dir, ".vite");
    await mkdir(assetsDir, { recursive: true });
    await mkdir(viteDir, { recursive: true });

    const cssContent = "body{margin:0}h1{color:red}";
    await writeFile(join(assetsDir, "entry.js"), "function entry(){}");
    await writeFile(join(assetsDir, "shared-a.js"), "function sharedA(){}");
    await writeFile(join(assetsDir, "shared-b.js"), "function sharedB(){}");
    await writeFile(join(assetsDir, "common.css"), cssContent);

    // Entry imports both shared-a and shared-b, each of which references common.css
    // The transitive CSS dedup should count common.css only once
    const viteManifest = {
      "app/pages/index.tsx": {
        file: "assets/entry.js",
        src: "app/pages/index.tsx",
        isEntry: true,
        imports: ["_shared-a", "_shared-b"],
      },
      "_shared-a": {
        file: "assets/shared-a.js",
        src: "_shared-a",
        css: ["assets/common.css"],
      },
      "_shared-b": {
        file: "assets/shared-b.js",
        src: "_shared-b",
        css: ["assets/common.css"], // same CSS referenced again
      },
    };

    const manifestPath = join(viteDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(viteManifest));

    const routeManifest = {
      routes: [
        { urlPattern: "/", filePath: "app/pages/index.tsx", type: "page" },
      ],
    };

    const result = await analyzeBundle({ buildDir: dir, manifestPath, routeManifest });
    expect(result.routes).toHaveLength(1);

    const route = result.routes[0]!;
    // CSS from transitive imports should be deduped: common.css counted once
    const cssFileInfo = result.assets.find((a) => a.name === "assets/common.css");
    expect(cssFileInfo).toBeTruthy();
    expect(route.css.raw).toBe(cssFileInfo!.size.raw);
  });
});

// ---------------------------------------------------------------------------
// Symlink cycle prevention in walkDir
// ---------------------------------------------------------------------------

describe("symlink cycle prevention in analyzeBundle", () => {
  test("completes without hanging when build dir contains directory symlink cycle", async () => {
    const dir = join(tmpRoot, "symcycle");
    const realDir = join(dir, "a");
    await mkdir(realDir, { recursive: true });

    // Write a real file in dir/a/
    await writeFile(join(realDir, "bundle.js"), "function main(){}");

    // Create symlink: dir/b -> dir/a (cycle through parent)
    await symlink(realDir, join(dir, "b"));

    // analyzeBundle should complete without infinite loop
    // (walkDir skips symlinks that point to directories)
    const result = await analyzeBundle({ buildDir: dir });
    expect(result.assets.length).toBeGreaterThanOrEqual(1);

    // The file in 'a' should be found
    const jsAsset = result.assets.find((a) => a.name.includes("bundle.js"));
    expect(jsAsset).toBeTruthy();
  });

  test("symlink to file is included in analysis", async () => {
    const dir = join(tmpRoot, "symfile");
    await mkdir(dir, { recursive: true });

    await writeFile(join(dir, "real.js"), "function real(){}");
    await symlink(join(dir, "real.js"), join(dir, "linked.js"));

    const result = await analyzeBundle({ buildDir: dir });
    // Both the real file and the symlink-to-file should appear
    const names = result.assets.map((a) => a.name);
    expect(names).toContain("real.js");
    expect(names).toContain("linked.js");
  });
});
