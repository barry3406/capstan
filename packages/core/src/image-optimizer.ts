import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: "auto" | "avif" | "webp" | "jpeg" | "png";
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
}

export interface ImageTransformResult {
  data: Uint8Array;
  format: string;
  contentType: string;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
}

export interface ImageOptimizerConfig {
  /** Cache directory for transformed images. Default: .capstan/image-cache */
  cacheDir?: string;
  /** Max allowed source width. Default: 4096 */
  maxWidth?: number;
  /** Max allowed source height. Default: 4096 */
  maxHeight?: number;
  /** Default quality. Default: 80 */
  defaultQuality?: number;
  /** Allowed source directories (security). Default: ["public", "app/public"] */
  allowedDirs?: string[];
  /** Maximum cache size in bytes. Default: 100MB */
  maxCacheSize?: number;
}

export interface ImageOptimizer {
  transform(
    sourcePath: string,
    options: ImageTransformOptions,
    accept?: string,
  ): Promise<ImageTransformResult>;
  getCached(cacheKey: string): Promise<ImageTransformResult | null>;
  clearCache(): Promise<void>;
  readonly available: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_DIR = ".capstan/image-cache";
const DEFAULT_MAX_WIDTH = 4096;
const DEFAULT_MAX_HEIGHT = 4096;
const DEFAULT_QUALITY = 80;
const DEFAULT_ALLOWED_DIRS = ["public", "app/public"];
const DEFAULT_MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100 MB

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".svg",
  ".ico",
  ".bmp",
  ".tiff",
  ".tif",
]);

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
};

// ---------------------------------------------------------------------------
// Utility: negotiateFormat
// ---------------------------------------------------------------------------

export function negotiateFormat(
  accept: string | null | undefined,
): "avif" | "webp" | "jpeg" {
  if (!accept) return "jpeg";

  const lower = accept.toLowerCase();
  if (lower.includes("image/avif")) return "avif";
  if (lower.includes("image/webp")) return "webp";
  return "jpeg";
}

// ---------------------------------------------------------------------------
// Utility: computeImageCacheKey
// ---------------------------------------------------------------------------

export function computeImageCacheKey(
  sourcePath: string,
  options: ImageTransformOptions,
  format: string,
): string {
  const payload = JSON.stringify({
    src: sourcePath,
    w: options.width,
    h: options.height,
    q: options.quality,
    f: format,
    fit: options.fit,
  });
  return createHash("sha256").update(payload).digest("hex");
}

// ---------------------------------------------------------------------------
// Utility: normalizeTransformOptions
// ---------------------------------------------------------------------------

export function normalizeTransformOptions(
  options: ImageTransformOptions,
): ImageTransformOptions {
  const result: ImageTransformOptions = {};

  if (options.width !== undefined) {
    const w = Number(options.width);
    if (Number.isFinite(w) && w >= 1) {
      result.width = Math.round(Math.min(w, DEFAULT_MAX_WIDTH));
    }
  }

  if (options.height !== undefined) {
    const h = Number(options.height);
    if (Number.isFinite(h) && h >= 1) {
      result.height = Math.round(Math.min(h, DEFAULT_MAX_HEIGHT));
    }
  }

  if (options.quality !== undefined) {
    const q = Number(options.quality);
    if (Number.isFinite(q) && q >= 1) {
      result.quality = Math.round(Math.min(q, 100));
    }
  }

  const validFormats: ReadonlySet<string> = new Set(["auto", "avif", "webp", "jpeg", "png"]);
  if (
    options.format !== undefined &&
    typeof options.format === "string" &&
    validFormats.has(options.format)
  ) {
    result.format = options.format;
  }

  const validFits: ReadonlySet<string> = new Set([
    "cover",
    "contain",
    "fill",
    "inside",
    "outside",
  ]);
  if (
    options.fit !== undefined &&
    typeof options.fit === "string" &&
    validFits.has(options.fit)
  ) {
    result.fit = options.fit;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Utility: parseImageQuery
// ---------------------------------------------------------------------------

export function parseImageQuery(
  url: string | URL,
): { src: string; options: ImageTransformOptions } | { error: string } {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url, "http://localhost") : url;
  } catch {
    return { error: "Invalid URL" };
  }

  const src = parsed.searchParams.get("url");
  if (!src || src.trim() === "") {
    return { error: "Missing required 'url' parameter" };
  }

  // Security: reject protocol prefixes (including data:, file://, http://, etc.)
  if (/^[a-z]+:/i.test(src)) {
    return { error: "Protocol prefixes are not allowed in source path" };
  }

  // Security: reject path traversal
  if (src.includes("..")) {
    return { error: "Path traversal is not allowed" };
  }

  // Security: reject absolute filesystem paths (not starting with /)
  // We allow paths starting with / since those are URL paths,
  // but reject things like C:\ etc.
  if (/^[A-Za-z]:[/\\]/.test(src)) {
    return { error: "Absolute filesystem paths are not allowed" };
  }

  const rawW = parsed.searchParams.get("w");
  const rawH = parsed.searchParams.get("h");
  const rawQ = parsed.searchParams.get("q");
  const rawF = parsed.searchParams.get("f");
  const rawFit = parsed.searchParams.get("fit");

  const options: ImageTransformOptions = {};

  if (rawW !== null) {
    const w = Number(rawW);
    if (!Number.isFinite(w) || w < 1) {
      return { error: `Invalid width: ${rawW}` };
    }
    options.width = w;
  }

  if (rawH !== null) {
    const h = Number(rawH);
    if (!Number.isFinite(h) || h < 1) {
      return { error: `Invalid height: ${rawH}` };
    }
    options.height = h;
  }

  if (rawQ !== null) {
    const q = Number(rawQ);
    if (!Number.isFinite(q) || q < 1 || q > 100) {
      return { error: `Invalid quality: ${rawQ}` };
    }
    options.quality = q;
  }

  if (rawF !== null) {
    const validFormats: ReadonlySet<string> = new Set(["auto", "avif", "webp", "jpeg", "png"]);
    if (!validFormats.has(rawF)) {
      return { error: `Invalid format: ${rawF}` };
    }
    options.format = rawF as "auto" | "avif" | "webp" | "jpeg" | "png";
  }

  if (rawFit !== null) {
    const validFits: ReadonlySet<string> = new Set([
      "cover",
      "contain",
      "fill",
      "inside",
      "outside",
    ]);
    if (!validFits.has(rawFit)) {
      return { error: `Invalid fit: ${rawFit}` };
    }
    options.fit = rawFit as "cover" | "contain" | "fill" | "inside" | "outside";
  }

  return { src, options };
}

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

function isPathTraversal(sourcePath: string): boolean {
  return sourcePath.includes("..") || sourcePath.includes("\0") || /^[a-z]+:/i.test(sourcePath);
}

function isImageExtension(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

type SourceResolution =
  | { status: "ok"; path: string }
  | { status: "forbidden" }
  | { status: "not_found" };

async function resolveSourcePath(
  rootDir: string,
  sourcePath: string,
  allowedDirs: string[],
): Promise<SourceResolution> {
  // Strip leading slash for filesystem resolution
  const relative = sourcePath.startsWith("/")
    ? sourcePath.slice(1)
    : sourcePath;
  const normalizedRelative = normalize(relative);

  let anyAllowed = false;

  for (const dir of allowedDirs) {
    const candidate = resolve(rootDir, dir, normalizedRelative);
    const allowedBase = resolve(rootDir, dir);

    // Ensure the resolved path is within the allowed directory
    if (candidate.startsWith(allowedBase + "/") || candidate === allowedBase) {
      anyAllowed = true;
      try {
        await access(candidate);
        // Resolve symlinks and re-check the real path is still within bounds
        const realCandidate = await realpath(candidate);
        const realBase = await realpath(allowedBase);
        if (!realCandidate.startsWith(realBase + "/") && realCandidate !== realBase) {
          return { status: "forbidden" };
        }
        return { status: "ok", path: realCandidate };
      } catch {
        // File doesn't exist in this allowed dir, try next
        continue;
      }
    }
  }

  // If at least one candidate was within an allowed dir but file was missing
  if (anyAllowed) {
    return { status: "not_found" };
  }

  return { status: "forbidden" };
}

function getFormatFromExtension(filePath: string): string {
  const ext = extname(filePath).toLowerCase().slice(1);
  if (ext === "jpg") return "jpeg";
  return ext;
}

function getContentType(format: string): string {
  return MIME_TYPES[format] ?? `image/${format}`;
}

// ---------------------------------------------------------------------------
// Cache metadata
// ---------------------------------------------------------------------------

interface CacheMetadata {
  format: string;
  contentType: string;
  width: number;
  height: number;
  originalSize: number;
  optimizedSize: number;
}

// ---------------------------------------------------------------------------
// createImageOptimizer
// ---------------------------------------------------------------------------

export function createImageOptimizer(
  rootDir: string,
  config?: ImageOptimizerConfig,
): ImageOptimizer {
  const cacheDir = resolve(
    rootDir,
    config?.cacheDir ?? DEFAULT_CACHE_DIR,
  );
  const maxWidth = config?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = config?.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const defaultQuality = config?.defaultQuality ?? DEFAULT_QUALITY;
  const allowedDirs = config?.allowedDirs ?? DEFAULT_ALLOWED_DIRS;
  const maxCacheSize = config?.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;

  // Track whether sharp is available
  let sharpModule: unknown = null;
  let sharpAvailable = false;
  let sharpLoaded = false;

  // In-flight deduplication map: sourceKey -> Promise
  const inflight = new Map<string, Promise<ImageTransformResult>>();

  async function loadSharp(): Promise<void> {
    if (sharpLoaded) return;
    sharpLoaded = true;
    try {
      // sharp is an optional peer dependency — dynamically imported
      // @ts-expect-error sharp may not be installed
      sharpModule = (await import("sharp")).default;
      sharpAvailable = true;
    } catch {
      sharpModule = null;
      sharpAvailable = false;
    }
  }

  async function ensureCacheDir(): Promise<void> {
    try {
      await mkdir(cacheDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  async function getCached(
    cacheKey: string,
  ): Promise<ImageTransformResult | null> {
    try {
      const metaPath = join(cacheDir, `${cacheKey}.json`);
      const metaRaw = await readFile(metaPath, "utf-8");
      const meta = JSON.parse(metaRaw) as CacheMetadata;
      // Validate cached format against known safe values to prevent path injection
      if (!/^[a-z]{2,8}$/.test(meta.format)) return null;
      const dataPath = join(cacheDir, `${cacheKey}.${meta.format}`);
      const data = new Uint8Array(await readFile(dataPath));
      return {
        data,
        format: meta.format,
        contentType: meta.contentType,
        width: meta.width,
        height: meta.height,
        originalSize: meta.originalSize,
        optimizedSize: meta.optimizedSize,
      };
    } catch {
      return null;
    }
  }

  async function writeCache(
    cacheKey: string,
    result: ImageTransformResult,
  ): Promise<void> {
    await ensureCacheDir();
    const meta: CacheMetadata = {
      format: result.format,
      contentType: result.contentType,
      width: result.width,
      height: result.height,
      originalSize: result.originalSize,
      optimizedSize: result.optimizedSize,
    };
    const metaPath = join(cacheDir, `${cacheKey}.json`);
    const dataPath = join(cacheDir, `${cacheKey}.${result.format}`);
    await writeFile(metaPath, JSON.stringify(meta));
    await writeFile(dataPath, result.data);
  }

  async function evictIfNeeded(): Promise<void> {
    try {
      await access(cacheDir);
    } catch {
      return; // Cache dir doesn't exist yet
    }

    const entries = await readdir(cacheDir);
    const fileStats: Array<{ name: string; size: number; mtimeMs: number }> = [];
    let totalSize = 0;

    for (const entry of entries) {
      try {
        const s = await stat(join(cacheDir, entry));
        if (s.isFile()) {
          fileStats.push({ name: entry, size: s.size, mtimeMs: s.mtimeMs });
          totalSize += s.size;
        }
      } catch {
        // Skip files we can't stat
      }
    }

    if (totalSize <= maxCacheSize) return;

    // Sort by oldest first (LRU eviction)
    fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const file of fileStats) {
      if (totalSize <= maxCacheSize) break;
      try {
        await rm(join(cacheDir, file.name));
        totalSize -= file.size;
      } catch {
        // Best effort
      }
    }
  }

  async function transform(
    sourcePath: string,
    options: ImageTransformOptions,
    accept?: string,
  ): Promise<ImageTransformResult> {
    await loadSharp();

    // Security checks
    if (isPathTraversal(sourcePath)) {
      throw new ImageOptimizerError(
        "Path traversal is not allowed",
        "FORBIDDEN",
      );
    }

    // Check image extension before resolving (uses the raw source path)
    if (!isImageExtension(sourcePath)) {
      throw new ImageOptimizerError(
        "Unsupported file type",
        "UNSUPPORTED_FORMAT",
      );
    }

    const resolution = await resolveSourcePath(rootDir, sourcePath, allowedDirs);
    if (resolution.status === "forbidden") {
      throw new ImageOptimizerError(
        "Source path is outside allowed directories",
        "FORBIDDEN",
      );
    }
    if (resolution.status === "not_found") {
      throw new ImageOptimizerError("Source file not found", "NOT_FOUND");
    }

    const resolvedPath = resolution.path;

    const normalized = normalizeTransformOptions(options);
    const sourceFormat = getFormatFromExtension(resolvedPath);

    // SVG: return as-is (no transform)
    if (sourceFormat === "svg") {
      const data = new Uint8Array(await readFile(resolvedPath));
      return {
        data,
        format: "svg",
        contentType: "image/svg+xml",
        width: normalized.width ?? 0,
        height: normalized.height ?? 0,
        originalSize: data.byteLength,
        optimizedSize: data.byteLength,
      };
    }

    // Determine output format
    let outputFormat: string;
    if (normalized.format && normalized.format !== "auto") {
      outputFormat = normalized.format;
    } else if (normalized.format === "auto" || options.format === "auto") {
      outputFormat = negotiateFormat(accept);
    } else {
      outputFormat = sourceFormat;
    }

    // Check cache
    const cacheKey = computeImageCacheKey(sourcePath, normalized, outputFormat);

    const cached = await getCached(cacheKey);
    if (cached) return cached;

    // Deduplicate concurrent requests for the same transform
    const existing = inflight.get(cacheKey);
    if (existing) return existing;

    const transformPromise = performTransform(
      resolvedPath,
      normalized,
      outputFormat,
      cacheKey,
    );
    inflight.set(cacheKey, transformPromise);

    try {
      return await transformPromise;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  async function performTransform(
    resolvedPath: string,
    normalized: ImageTransformOptions,
    outputFormat: string,
    cacheKey: string,
  ): Promise<ImageTransformResult> {
    const originalData = await readFile(resolvedPath);
    const originalSize = originalData.byteLength;

    if (!sharpAvailable || !sharpModule) {
      // Fallback: return original file with correct headers
      const sourceFormat = getFormatFromExtension(resolvedPath);
      const result: ImageTransformResult = {
        data: new Uint8Array(originalData),
        format: sourceFormat,
        contentType: getContentType(sourceFormat),
        width: normalized.width ?? 0,
        height: normalized.height ?? 0,
        originalSize,
        optimizedSize: originalSize,
      };

      // Cache even the fallback to avoid re-reading on repeated requests
      await writeCache(cacheKey, result);

      return result;
    }

    // Use sharp for transformation
    const sharp = sharpModule as (
      input: Buffer | Uint8Array,
    ) => SharpInstance;

    let pipeline = sharp(new Uint8Array(originalData));

    // Get metadata for validation
    const metadata = await pipeline.metadata();

    if (metadata.width && metadata.width > maxWidth) {
      throw new ImageOptimizerError(
        `Source image width ${metadata.width} exceeds maximum ${maxWidth}`,
        "INVALID_DIMENSIONS",
      );
    }
    if (metadata.height && metadata.height > maxHeight) {
      throw new ImageOptimizerError(
        `Source image height ${metadata.height} exceeds maximum ${maxHeight}`,
        "INVALID_DIMENSIONS",
      );
    }

    // Resize
    if (normalized.width !== undefined || normalized.height !== undefined) {
      const resizeOpts: { width?: number; height?: number; fit?: string } = {
        fit: normalized.fit ?? "cover",
      };
      if (normalized.width !== undefined) {
        resizeOpts.width = normalized.width;
      }
      if (normalized.height !== undefined) {
        resizeOpts.height = normalized.height;
      }
      pipeline = pipeline.resize(resizeOpts);
    }

    // Format conversion and quality
    const quality = normalized.quality ?? defaultQuality;
    switch (outputFormat) {
      case "avif":
        pipeline = pipeline.avif({ quality });
        break;
      case "webp":
        pipeline = pipeline.webp({ quality });
        break;
      case "jpeg":
        pipeline = pipeline.jpeg({ quality });
        break;
      case "png":
        pipeline = pipeline.png();
        break;
      default:
        pipeline = pipeline.toFormat(outputFormat as never, { quality });
    }

    const outputBuffer = await pipeline.toBuffer({ resolveWithObject: true });
    const result: ImageTransformResult = {
      data: new Uint8Array(outputBuffer.data),
      format: outputFormat,
      contentType: getContentType(outputFormat),
      width: outputBuffer.info.width,
      height: outputBuffer.info.height,
      originalSize,
      optimizedSize: outputBuffer.data.byteLength,
    };

    // Cache the result
    await writeCache(cacheKey, result);
    await evictIfNeeded();

    return result;
  }

  async function clearCache(): Promise<void> {
    try {
      await rm(cacheDir, { recursive: true, force: true });
    } catch {
      // Already cleared or doesn't exist
    }
  }

  return {
    transform,
    getCached,
    clearCache,
    get available() {
      return sharpAvailable;
    },
  };
}

// ---------------------------------------------------------------------------
// ImageOptimizerError
// ---------------------------------------------------------------------------

export type ImageOptimizerErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNSUPPORTED_FORMAT"
  | "INVALID_DIMENSIONS"
  | "TRANSFORM_ERROR";

export class ImageOptimizerError extends Error {
  readonly code: ImageOptimizerErrorCode;
  constructor(message: string, code: ImageOptimizerErrorCode) {
    super(message);
    this.name = "ImageOptimizerError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Sharp type stubs (for dynamic import)
// ---------------------------------------------------------------------------

interface SharpMetadata {
  width?: number;
  height?: number;
  format?: string;
}

interface SharpOutputInfo {
  width: number;
  height: number;
  size: number;
}

interface SharpInstance {
  metadata(): Promise<SharpMetadata>;
  resize(options: {
    width?: number;
    height?: number;
    fit?: string;
  }): SharpInstance;
  avif(options: { quality: number }): SharpInstance;
  webp(options: { quality: number }): SharpInstance;
  jpeg(options: { quality: number }): SharpInstance;
  png(): SharpInstance;
  toFormat(format: never, options: { quality: number }): SharpInstance;
  toBuffer(options: {
    resolveWithObject: true;
  }): Promise<{ data: Buffer; info: SharpOutputInfo }>;
}
