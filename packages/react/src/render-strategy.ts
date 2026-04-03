import type {
  RenderMode,
  RenderPageOptions,
  RenderResult,
} from "./types.js";
import { renderPage } from "./ssr.js";

/**
 * Minimal interface for the response cache functions we need from
 * @zauso-ai/capstan-core.  Defined here to avoid a hard dependency
 * on the core package (which may not be available in all environments).
 */
interface ResponseCacheFacade {
  responseCacheGet(key: string): Promise<{
    entry: { html: string; statusCode: number };
    stale: boolean;
  } | undefined>;
  responseCacheSet(
    key: string,
    entry: {
      html: string;
      headers: Record<string, string>;
      statusCode: number;
      createdAt: number;
      revalidateAfter: number | null;
      tags: string[];
    },
  ): Promise<void>;
  responseCacheInvalidate?(key: string): Promise<boolean>;
  responseCacheInvalidateTag?(tag: string): Promise<number>;
  cacheInvalidatePath?(url: string): Promise<boolean>;
  cacheInvalidateTag?(tag: string): Promise<number>;
}

let _responseCache: ResponseCacheFacade | null = null;
const inFlightRevalidations = new Map<string, Promise<void>>();

function joinPath(...segments: string[]): string {
  const normalized = segments
    .filter((segment) => segment.length > 0)
    .join("/")
    .replace(/\/+/g, "/");

  if (normalized === "") {
    return ".";
  }

  return normalized.startsWith("/") ? normalized : normalized;
}

async function readTextFile(filePath: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf-8");
}

function getDefaultStaticDir(): string {
  const cwd =
    typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";

  return joinPath(cwd, "dist", "static");
}

async function getResponseCache(): Promise<ResponseCacheFacade | null> {
  if (_responseCache) return _responseCache;
  try {
    // Use a variable to prevent TypeScript from resolving the specifier
    // at compile time — the core package is an optional peer dependency.
    const corePkg = "@zauso-ai/capstan-core";
    _responseCache = await import(corePkg) as unknown as ResponseCacheFacade;
    return _responseCache;
  } catch {
    return null;
  }
}

/**
 * Page-level caches are keyed by pathname only. Query strings and hashes are
 * intentionally ignored so SSR, SSG, ISR, and invalidation APIs all target the
 * same document entry for a route.
 */
export function normalizePagePath(url: string): string {
  const raw = typeof url === "string" ? url.trim() : "";
  if (raw === "") return "/";

  let pathname: string;
  if (raw.startsWith("/")) {
    pathname = raw.split("?")[0]!.split("#")[0]!;
  } else {
    try {
      pathname = new URL(raw, "http://capstan.local").pathname;
    } catch {
      pathname = raw.split("?")[0]!.split("#")[0]!;
    }
  }

  if (pathname === "") return "/";
  const normalized = pathname.replace(/\/{2,}/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function createPageCacheKey(url: string): string {
  return `page:${normalizePagePath(url)}`;
}

function normalizeCacheTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];

  const normalized = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim();
    if (trimmed !== "") {
      normalized.add(trimmed);
    }
  }

  return Array.from(normalized);
}

function normalizeRevalidateSeconds(revalidate: number | undefined): number | undefined {
  if (revalidate === undefined) return undefined;
  if (!Number.isFinite(revalidate) || revalidate < 0) {
    return 0;
  }
  return revalidate;
}

function resolveRevalidateAfter(revalidate: number | undefined, now: number): number | null | undefined {
  const normalized = normalizeRevalidateSeconds(revalidate);
  if (normalized === undefined) return undefined;
  return now + normalized * 1000;
}

export async function invalidatePagePath(url: string): Promise<boolean> {
  const cache = await getResponseCache();
  const cacheKey = createPageCacheKey(url);
  inFlightRevalidations.delete(cacheKey);

  if (cache?.cacheInvalidatePath) {
    return cache.cacheInvalidatePath(url);
  }

  if (!cache?.responseCacheInvalidate) {
    return false;
  }

  return cache.responseCacheInvalidate(cacheKey);
}

export async function invalidatePageTag(tag: string): Promise<number> {
  const normalizedTag = typeof tag === "string" ? tag.trim() : "";
  if (normalizedTag === "") {
    return 0;
  }

  const cache = await getResponseCache();
  inFlightRevalidations.clear();

  if (cache?.cacheInvalidateTag) {
    return cache.cacheInvalidateTag(normalizedTag);
  }

  if (!cache?.responseCacheInvalidateTag) {
    return 0;
  }

  return cache.responseCacheInvalidateTag(normalizedTag);
}

export interface RenderStrategyContext {
  options: RenderPageOptions;
  url: string;
  revalidate?: number;
  cacheTags?: string[];
}

export interface RenderStrategyResult extends RenderResult {
  cacheStatus?: "HIT" | "MISS" | "STALE";
}

export interface RenderStrategy {
  render(ctx: RenderStrategyContext): Promise<RenderStrategyResult>;
}

/**
 * Default SSR — delegates to the existing renderPage().
 */
export class SSRStrategy implements RenderStrategy {
  async render(ctx: RenderStrategyContext): Promise<RenderStrategyResult> {
    const result = await renderPage(ctx.options);
    return { ...result, cacheStatus: "MISS" };
  }
}

/**
 * ISR — page-level response cache with stale-while-revalidate.
 *
 * 1. Cache HIT (fresh)  → return cached HTML immediately
 * 2. Cache HIT (stale)  → return cached HTML, fire-and-forget revalidation
 * 3. Cache MISS          → SSR render, store in cache, return
 */
export class ISRStrategy implements RenderStrategy {
  private ssr = new SSRStrategy();

  async render(ctx: RenderStrategyContext): Promise<RenderStrategyResult> {
    const cache = await getResponseCache();
    const cacheKey = createPageCacheKey(ctx.url);

    if (cache) {
      const cached = await cache.responseCacheGet(cacheKey);

      if (cached && !cached.stale) {
        return {
          html: cached.entry.html,
          loaderData: null,
          statusCode: cached.entry.statusCode,
          cacheStatus: "HIT",
        };
      }

      if (cached?.stale) {
        this.scheduleRevalidation(ctx, cacheKey, cache);
        return {
          html: cached.entry.html,
          loaderData: null,
          statusCode: cached.entry.statusCode,
          cacheStatus: "STALE",
        };
      }
    }

    // Cache miss — render and store
    const result = await this.ssr.render(ctx);

    if (cache && ctx.revalidate !== undefined) {
      const now = Date.now();
      await cache.responseCacheSet(cacheKey, {
        html: result.html,
        headers: {},
        statusCode: result.statusCode,
        createdAt: now,
        revalidateAfter: resolveRevalidateAfter(ctx.revalidate, now) ?? null,
        tags: normalizeCacheTags(ctx.cacheTags),
      });
    }

    return { ...result, cacheStatus: "MISS" };
  }

  private scheduleRevalidation(
    ctx: RenderStrategyContext,
    cacheKey: string,
    cache: ResponseCacheFacade,
  ): void {
    if (inFlightRevalidations.has(cacheKey)) {
      return;
    }

    const task = this.revalidateInBackground(ctx, cacheKey, cache)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          `[capstan] ISR background revalidation failed for ${cacheKey}:`,
          err instanceof Error ? err.message : err,
        );
      })
      .finally(() => {
        inFlightRevalidations.delete(cacheKey);
      });

    inFlightRevalidations.set(cacheKey, task);
  }

  private async revalidateInBackground(
    ctx: RenderStrategyContext,
    cacheKey: string,
    cache: ResponseCacheFacade,
  ): Promise<void> {
    const result = await this.ssr.render(ctx);
    const now = Date.now();
    await cache.responseCacheSet(cacheKey, {
      html: result.html,
      headers: {},
      statusCode: result.statusCode,
      createdAt: now,
      revalidateAfter: resolveRevalidateAfter(ctx.revalidate, now) ?? null,
      tags: normalizeCacheTags(ctx.cacheTags),
    });
  }
}

/**
 * Map a URL path to the corresponding pre-rendered file on disk.
 *   "/"      → "<staticDir>/index.html"
 *   "/about" → "<staticDir>/about/index.html"
 */
export function urlToFilePath(url: string, staticDir: string): string {
  const pathname = normalizePagePath(url);
  const segments = pathname.replace(/^\/+|\/+$/g, "");
  if (segments === "") return joinPath(staticDir, "index.html");
  return joinPath(staticDir, segments, "index.html");
}

/**
 * SSG — serves pre-rendered HTML files from the build output directory.
 * Falls back to SSR at runtime when the static file doesn't exist
 * (e.g., pages not covered by `generateStaticParams`).
 */
export class SSGStrategy implements RenderStrategy {
  private ssr = new SSRStrategy();
  private staticDir: string;

  constructor(staticDir?: string) {
    this.staticDir = staticDir ?? getDefaultStaticDir();
  }

  async render(ctx: RenderStrategyContext): Promise<RenderStrategyResult> {
    const filePath = urlToFilePath(ctx.url, this.staticDir);
    try {
      const html = await readTextFile(filePath);
      return { html, loaderData: null, statusCode: 200, cacheStatus: "HIT" };
    } catch {
      // File not found — fall back to SSR
      return { ...await this.ssr.render(ctx), cacheStatus: "MISS" };
    }
  }
}

/**
 * Create the appropriate render strategy for a given mode.
 */
export function createStrategy(
  mode: RenderMode,
  opts?: { staticDir?: string },
): RenderStrategy {
  switch (mode) {
    case "isr":
      return new ISRStrategy();
    case "ssg":
      return new SSGStrategy(opts?.staticDir);
    case "ssr":
    case "streaming":
    default:
      return new SSRStrategy();
  }
}
