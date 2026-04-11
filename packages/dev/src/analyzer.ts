/**
 * Client bundle analyzer for Capstan.
 *
 * Measures raw / gzip / brotli sizes of build output, maps chunks to routes
 * via the Vite manifest, and enforces configurable budgets.
 */

import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";

// ---------------------------------------------------------------------------
// Size types
// ---------------------------------------------------------------------------

export interface BundleSizeEntry {
  raw: number;
  gzip: number;
  brotli: number;
}

// ---------------------------------------------------------------------------
// Analysis result types
// ---------------------------------------------------------------------------

export interface ChunkEntry {
  name: string;
  size: BundleSizeEntry;
  modules: string[];
  isEntry: boolean;
  isDynamic: boolean;
}

export interface AssetEntry {
  name: string;
  size: BundleSizeEntry;
  type: "js" | "css" | "image" | "font" | "other";
}

export interface RouteBundleEntry {
  pattern: string;
  filePath: string;
  js: BundleSizeEntry;
  css: BundleSizeEntry;
  total: BundleSizeEntry;
  chunks: string[];
}

export interface BundleAnalysis {
  timestamp: string;
  totalSize: BundleSizeEntry;
  jsSize: BundleSizeEntry;
  cssSize: BundleSizeEntry;
  routes: RouteBundleEntry[];
  chunks: ChunkEntry[];
  assets: AssetEntry[];
  routeCount: number;
  sharedChunkCount: number;
}

// ---------------------------------------------------------------------------
// Budget types
// ---------------------------------------------------------------------------

export interface BundleBudget {
  maxTotalSizeKb?: number;
  maxRouteSizeKb?: number;
  maxChunkSizeKb?: number;
  maxCssSizeKb?: number;
  maxJsSizeKb?: number;
  useGzip?: boolean;
}

export interface BudgetViolation {
  rule: keyof BundleBudget;
  limit: number;
  actual: number;
  target?: string;
  message: string;
}

export interface BudgetCheckResult {
  passed: boolean;
  violations: BudgetViolation[];
}

// ---------------------------------------------------------------------------
// Default budgets
// ---------------------------------------------------------------------------

export const DEFAULT_BUDGETS: BundleBudget = {
  maxTotalSizeKb: 250,
  maxRouteSizeKb: 100,
  maxChunkSizeKb: 150,
  maxCssSizeKb: 50,
  maxJsSizeKb: 200,
  useGzip: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO_SIZE: BundleSizeEntry = { raw: 0, gzip: 0, brotli: 0 };

function addSizes(a: BundleSizeEntry, b: BundleSizeEntry): BundleSizeEntry {
  return { raw: a.raw + b.raw, gzip: a.gzip + b.gzip, brotli: a.brotli + b.brotli };
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico"]);
const FONT_EXTS = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot"]);

function classifyAssetType(fileName: string): AssetEntry["type"] {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "js";
  if (ext === ".css") return "css";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (FONT_EXTS.has(ext)) return "font";
  return "other";
}

function isSourceMap(fileName: string): boolean {
  return fileName.endsWith(".map");
}

/** Format bytes into a human-readable string. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Core: computeSizes
// ---------------------------------------------------------------------------

export async function computeSizes(content: string | Uint8Array): Promise<BundleSizeEntry> {
  const buf =
    typeof content === "string"
      ? Buffer.from(content, "utf-8")
      : Buffer.from(content);

  if (buf.length === 0) return { ...ZERO_SIZE };

  const gzip = gzipSync(buf).length;
  const brotli = brotliCompressSync(buf, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_DEFAULT_QUALITY },
  }).length;

  return { raw: buf.length, gzip, brotli };
}

// ---------------------------------------------------------------------------
// Internal file tree walker
// ---------------------------------------------------------------------------

interface FileEntry {
  relativePath: string;
  absolutePath: string;
}

async function walkDir(root: string, prefix = ""): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  let names: string[];

  try {
    names = await readdir(root);
  } catch {
    return entries;
  }

  for (const name of names) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const abs = join(root, name);

    let s: Awaited<ReturnType<typeof lstat>>;
    try {
      s = await lstat(abs);
    } catch {
      continue;
    }

    // Skip symlinks that point to directories to prevent infinite cycles.
    if (s.isSymbolicLink()) {
      try {
        const target = await stat(abs);
        if (target.isDirectory()) continue;
        // Symlink to a file — include it.
        if (target.isFile()) {
          entries.push({ relativePath: rel, absolutePath: abs });
        }
      } catch {
        continue;
      }
    } else if (s.isDirectory()) {
      const nested = await walkDir(abs, rel);
      entries.push(...nested);
    } else if (s.isFile()) {
      entries.push({ relativePath: rel, absolutePath: abs });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Vite manifest types (only the subset we need)
// ---------------------------------------------------------------------------

interface ViteManifestEntry {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  css?: string[];
  imports?: string[];
  dynamicImports?: string[];
}

type ViteManifest = Record<string, ViteManifestEntry>;

// ---------------------------------------------------------------------------
// Core: analyzeBundle
// ---------------------------------------------------------------------------

export async function analyzeBundle(options: {
  buildDir: string;
  manifestPath?: string;
  routeManifest?: { routes: Array<{ urlPattern: string; filePath: string; type: string }> };
}): Promise<BundleAnalysis> {
  const { buildDir, manifestPath, routeManifest } = options;

  // Validate build dir exists
  try {
    const s = await stat(buildDir);
    if (!s.isDirectory()) {
      throw new Error(`Not a directory: ${buildDir}`);
    }
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT") {
      throw new Error(`Build directory does not exist: ${buildDir}`);
    }
    throw err;
  }

  // Walk all files
  const allFiles = await walkDir(buildDir);

  // Filter out source maps
  const files = allFiles.filter((f) => !isSourceMap(f.relativePath));

  // Compute sizes for every file
  const fileSizeMap = new Map<string, { entry: FileEntry; size: BundleSizeEntry; type: AssetEntry["type"] }>();
  for (const f of files) {
    let buf: Buffer;
    try {
      buf = await readFile(f.absolutePath);
    } catch {
      // Unreadable file — skip gracefully
      continue;
    }
    const size = await computeSizes(buf);
    const type = classifyAssetType(f.relativePath);
    fileSizeMap.set(f.relativePath, { entry: f, size, type });
  }

  // Build assets list
  const assets: AssetEntry[] = [];
  for (const [relPath, info] of fileSizeMap) {
    assets.push({ name: relPath, size: info.size, type: info.type });
  }

  // Aggregate JS/CSS totals
  let jsSize: BundleSizeEntry = { ...ZERO_SIZE };
  let cssSize: BundleSizeEntry = { ...ZERO_SIZE };
  for (const a of assets) {
    if (a.type === "js") jsSize = addSizes(jsSize, a.size);
    if (a.type === "css") cssSize = addSizes(cssSize, a.size);
  }
  const totalSize = addSizes(jsSize, cssSize);

  // Parse Vite manifest (if available)
  let viteManifest: ViteManifest | undefined;
  if (manifestPath) {
    try {
      const raw = await readFile(manifestPath, "utf-8");
      viteManifest = JSON.parse(raw) as ViteManifest;
    } catch {
      // Manifest unreadable — proceed without it
    }
  }

  // Build chunks list
  const chunks: ChunkEntry[] = [];
  const entryChunkFiles = new Set<string>();

  if (viteManifest) {
    for (const [src, entry] of Object.entries(viteManifest)) {
      const info = fileSizeMap.get(entry.file);
      if (!info) continue;
      if (info.type !== "js") continue;

      const isEntry = entry.isEntry === true;
      const isDynamic = entry.isDynamicEntry === true;
      if (isEntry) entryChunkFiles.add(entry.file);

      chunks.push({
        name: entry.file,
        size: info.size,
        modules: [src],
        isEntry,
        isDynamic,
      });
    }
  } else {
    // No manifest — list JS files as chunks without relationship data
    for (const [relPath, info] of fileSizeMap) {
      if (info.type !== "js") continue;
      chunks.push({
        name: relPath,
        size: info.size,
        modules: [],
        isEntry: false,
        isDynamic: false,
      });
    }
  }

  // Shared chunks: not an entry, not dynamic (only meaningful with manifest)
  const sharedChunkCount = viteManifest
    ? chunks.filter((c) => !c.isEntry && !c.isDynamic).length
    : 0;

  // Per-route analysis
  const routes: RouteBundleEntry[] = [];

  if (routeManifest && viteManifest) {
    // Build a lookup: source file -> manifest entry
    const srcToManifest = new Map<string, ViteManifestEntry>();
    for (const [src, entry] of Object.entries(viteManifest)) {
      srcToManifest.set(src, entry);
    }

    for (const route of routeManifest.routes) {
      // Try to find the route's entry in the Vite manifest
      const manifestEntry = srcToManifest.get(route.filePath);
      if (!manifestEntry) continue;

      let routeJs: BundleSizeEntry = { ...ZERO_SIZE };
      let routeCss: BundleSizeEntry = { ...ZERO_SIZE };
      const routeChunks: string[] = [];

      // Add the main JS chunk
      const mainInfo = fileSizeMap.get(manifestEntry.file);
      if (mainInfo) {
        routeJs = addSizes(routeJs, mainInfo.size);
        routeChunks.push(manifestEntry.file);
      }

      // Add CSS files
      if (manifestEntry.css) {
        for (const cssFile of manifestEntry.css) {
          const cssInfo = fileSizeMap.get(cssFile);
          if (cssInfo) {
            routeCss = addSizes(routeCss, cssInfo.size);
          }
        }
      }

      // Add imported (shared) chunks — resolve transitively
      const visited = new Set<string>();
      const importQueue = [...(manifestEntry.imports ?? [])];
      while (importQueue.length > 0) {
        const imp = importQueue.pop()!;
        if (visited.has(imp)) continue;
        visited.add(imp);

        const impEntry = srcToManifest.get(imp) ?? Object.values(viteManifest).find((e) => e.file === imp);
        if (!impEntry) continue;

        const impInfo = fileSizeMap.get(impEntry.file);
        if (impInfo) {
          routeJs = addSizes(routeJs, impInfo.size);
          routeChunks.push(impEntry.file);
        }
        // CSS from imported chunks
        if (impEntry.css) {
          for (const cssFile of impEntry.css) {
            if (!visited.has(`css:${cssFile}`)) {
              visited.add(`css:${cssFile}`);
              const cssInfo = fileSizeMap.get(cssFile);
              if (cssInfo) {
                routeCss = addSizes(routeCss, cssInfo.size);
              }
            }
          }
        }
        // Queue transitive imports
        if (impEntry.imports) {
          for (const transitive of impEntry.imports) {
            if (!visited.has(transitive)) importQueue.push(transitive);
          }
        }
      }

      routes.push({
        pattern: route.urlPattern,
        filePath: route.filePath,
        js: routeJs,
        css: routeCss,
        total: addSizes(routeJs, routeCss),
        chunks: routeChunks,
      });
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalSize,
    jsSize,
    cssSize,
    routes,
    chunks,
    assets,
    routeCount: routes.length,
    sharedChunkCount,
  };
}

// ---------------------------------------------------------------------------
// Core: checkBudgets
// ---------------------------------------------------------------------------

export function checkBudgets(
  analysis: BundleAnalysis,
  budgets: BundleBudget,
): BudgetCheckResult {
  const violations: BudgetViolation[] = [];

  // Determine which size metric to use
  const useGzip = budgets.useGzip !== false; // default true
  const pick = (s: BundleSizeEntry): number => (useGzip ? s.gzip : s.raw);

  const check = (
    rule: keyof BundleBudget,
    limitKb: number | undefined,
    actualBytes: number,
    target?: string,
  ) => {
    if (limitKb === undefined || limitKb === null) return;
    if (typeof limitKb !== "number" || Number.isNaN(limitKb)) return;

    const actualKb = actualBytes / 1024;
    if (actualKb > limitKb) {
      violations.push({
        rule,
        limit: limitKb,
        actual: Math.round(actualKb * 100) / 100,
        ...(target !== undefined ? { target } : {}),
        message: target
          ? `${rule}: ${target} is ${formatBytes(actualBytes)} (limit ${limitKb} KB)`
          : `${rule}: ${formatBytes(actualBytes)} exceeds ${limitKb} KB`,
      });
    }
  };

  check("maxTotalSizeKb", budgets.maxTotalSizeKb, pick(analysis.totalSize));
  check("maxJsSizeKb", budgets.maxJsSizeKb, pick(analysis.jsSize));
  check("maxCssSizeKb", budgets.maxCssSizeKb, pick(analysis.cssSize));

  // Per-route
  if (budgets.maxRouteSizeKb !== undefined) {
    for (const route of analysis.routes) {
      check("maxRouteSizeKb", budgets.maxRouteSizeKb, pick(route.total), route.pattern);
    }
  }

  // Per-chunk
  if (budgets.maxChunkSizeKb !== undefined) {
    for (const chunk of analysis.chunks) {
      check("maxChunkSizeKb", budgets.maxChunkSizeKb, pick(chunk.size), chunk.name);
    }
  }

  return { passed: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : " ".repeat(len - str.length) + str;
}

export function formatAnalysisTable(analysis: BundleAnalysis): string {
  const COL_ROUTE = 27;
  const COL_SIZE = 10;

  const lines: string[] = [];

  // Sort routes by total gzip size descending
  const sortedRoutes = [...analysis.routes].sort(
    (a, b) => b.total.gzip - a.total.gzip,
  );

  const hr = `\u251C${"─".repeat(COL_ROUTE + 2)}\u253C${"─".repeat(COL_SIZE + 2)}\u253C${"─".repeat(COL_SIZE + 2)}\u253C${"─".repeat(COL_SIZE + 4)}\u2524`;
  const topBorder = `\u250C${"─".repeat(COL_ROUTE + COL_SIZE * 3 + 12)}\u2510`;
  const bottomBorder = `\u2514${"─".repeat(COL_ROUTE + 2)}\u2534${"─".repeat(COL_SIZE + 2)}\u2534${"─".repeat(COL_SIZE + 2)}\u2534${"─".repeat(COL_SIZE + 4)}\u2518`;

  lines.push(topBorder);
  lines.push(`\u2502  Capstan Bundle Analysis${" ".repeat(COL_ROUTE + COL_SIZE * 3 + 12 - 26)}\u2502`);
  lines.push(hr);

  const header = `\u2502  ${padRight("Route", COL_ROUTE)}\u2502 ${padLeft("JS (gz)", COL_SIZE)} \u2502 ${padLeft("CSS (gz)", COL_SIZE)} \u2502 ${padLeft("Total (gz)", COL_SIZE + 2)} \u2502`;
  lines.push(header);
  lines.push(hr);

  if (sortedRoutes.length === 0) {
    const noRoutes = `\u2502  ${padRight("(no routes)", COL_ROUTE)}\u2502 ${padLeft("\u2014", COL_SIZE)} \u2502 ${padLeft("\u2014", COL_SIZE)} \u2502 ${padLeft("\u2014", COL_SIZE + 2)} \u2502`;
    lines.push(noRoutes);
  } else {
    for (const route of sortedRoutes) {
      const pattern = route.pattern.length > COL_ROUTE
        ? route.pattern.slice(0, COL_ROUTE - 1) + "\u2026"
        : route.pattern;
      const row = `\u2502  ${padRight(pattern, COL_ROUTE)}\u2502 ${padLeft(formatBytes(route.js.gzip), COL_SIZE)} \u2502 ${padLeft(formatBytes(route.css.gzip), COL_SIZE)} \u2502 ${padLeft(formatBytes(route.total.gzip), COL_SIZE + 2)} \u2502`;
      lines.push(row);
    }
  }

  lines.push(hr);

  const totalRow = `\u2502  ${padRight("Total (unique)", COL_ROUTE)}\u2502 ${padLeft(formatBytes(analysis.jsSize.gzip), COL_SIZE)} \u2502 ${padLeft(formatBytes(analysis.cssSize.gzip), COL_SIZE)} \u2502 ${padLeft(formatBytes(analysis.totalSize.gzip), COL_SIZE + 2)} \u2502`;
  lines.push(totalRow);

  const sharedJs = analysis.chunks
    .filter((c) => !c.isEntry && !c.isDynamic)
    .reduce<BundleSizeEntry>((acc, c) => addSizes(acc, c.size), { ...ZERO_SIZE });
  const sharedLabel = `Shared chunks (${analysis.sharedChunkCount})`;
  const sharedRow = `\u2502  ${padRight(sharedLabel, COL_ROUTE)}\u2502 ${padLeft(formatBytes(sharedJs.gzip), COL_SIZE)} \u2502 ${padLeft("\u2014", COL_SIZE)} \u2502 ${padLeft(formatBytes(sharedJs.gzip), COL_SIZE + 2)} \u2502`;
  lines.push(sharedRow);

  lines.push(bottomBorder);

  return lines.join("\n") + "\n";
}

export function formatAnalysisSummary(analysis: BundleAnalysis): string {
  const parts: string[] = [
    `Total: ${formatBytes(analysis.totalSize.gzip)} gzip (${formatBytes(analysis.totalSize.raw)} raw)`,
    `JS: ${formatBytes(analysis.jsSize.gzip)} | CSS: ${formatBytes(analysis.cssSize.gzip)}`,
    `Routes: ${analysis.routeCount} | Shared chunks: ${analysis.sharedChunkCount}`,
  ];
  return parts.join("\n") + "\n";
}

export function formatBudgetReport(result: BudgetCheckResult): string {
  if (result.passed) return "All budgets passed.\n";

  const lines: string[] = [`Budget violations (${result.violations.length}):\n`];
  for (const v of result.violations) {
    lines.push(`  - ${v.message}`);
  }
  return lines.join("\n") + "\n";
}
