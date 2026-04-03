import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
}

let _responseCache: ResponseCacheFacade | null = null;

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
    const cacheKey = `page:${ctx.url}`;

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
        // Fire-and-forget background revalidation — log failures so
        // operators can diagnose issues rather than silently serving stale
        // content forever.
        this.revalidateInBackground(ctx, cacheKey, cache).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(
            `[capstan] ISR background revalidation failed for ${cacheKey}:`,
            err instanceof Error ? err.message : err,
          );
        });
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
        revalidateAfter: now + ctx.revalidate * 1000,
        tags: ctx.cacheTags ?? [],
      });
    }

    return { ...result, cacheStatus: "MISS" };
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
      // Use strict undefined check — `revalidate: 0` means "always stale"
      // and must NOT fall through to `null` (which means "never stale").
      revalidateAfter:
        ctx.revalidate !== undefined ? now + ctx.revalidate * 1000 : null,
      tags: ctx.cacheTags ?? [],
    });
  }
}

/**
 * Map a URL path to the corresponding pre-rendered file on disk.
 *   "/"      → "<staticDir>/index.html"
 *   "/about" → "<staticDir>/about/index.html"
 */
export function urlToFilePath(url: string, staticDir: string): string {
  // Strip query string / hash
  const pathname = url.split("?")[0]!.split("#")[0]!;
  const segments = pathname.replace(/^\/+|\/+$/g, "");
  if (segments === "") return join(staticDir, "index.html");
  return join(staticDir, segments, "index.html");
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
    this.staticDir = staticDir ?? join(process.cwd(), "dist", "static");
  }

  async render(ctx: RenderStrategyContext): Promise<RenderStrategyResult> {
    const filePath = urlToFilePath(ctx.url, this.staticDir);
    try {
      const html = await readFile(filePath, "utf-8");
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
