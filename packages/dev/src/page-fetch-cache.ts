import type { PageFetchMethod } from "./page-fetch.js";

const NON_CACHEABLE_DIRECTIVES = ["no-store", "no-cache", "private"] as const;
const SHARED_CACHE_TAG_HEADER = "x-capstan-cache-tags";
const SHARED_CACHE_PATH_HEADER = "x-capstan-cache-paths";
const SHARED_CACHE_REVALIDATE_HEADER = "x-capstan-cache-revalidate";
const SHARED_CACHE_PREFIX = "page-fetch:";

interface SharedPageFetchCacheFacade {
  cacheGet<T>(key: string): Promise<{ data: T; stale: boolean } | undefined>;
  cacheSet<T>(
    key: string,
    data: T,
    opts?: {
      ttl?: number;
      revalidate?: number;
      tags?: string[];
    },
  ): Promise<void>;
}

let sharedPageFetchCache: SharedPageFetchCacheFacade | null = null;

function normalizeCachePath(url: string): string {
  const raw = url.trim();
  if (raw === "") {
    return "/";
  }

  let pathname: string;
  if (raw.startsWith("/")) {
    pathname = raw.split("?")[0]!.split("#")[0]!;
  } else {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      pathname = raw.split("?")[0]!.split("#")[0]!;
    }
  }

  const normalized = pathname.replace(/\/{2,}/g, "/");
  return normalized === "" ? "/" : normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function createCachePathTag(url: string): string {
  return `path:${normalizeCachePath(url)}`;
}

async function getSharedPageFetchCache(): Promise<SharedPageFetchCacheFacade | null> {
  if (sharedPageFetchCache) {
    return sharedPageFetchCache;
  }

  try {
    const corePkg = "@zauso-ai/capstan-core";
    sharedPageFetchCache = await import(corePkg) as unknown as SharedPageFetchCacheFacade;
    return sharedPageFetchCache;
  } catch {
    return null;
  }
}

function serializeHeaders(headers: Headers): string {
  const pairs = [...headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([nameA, valueA], [nameB, valueB]) => {
      if (nameA === nameB) {
        return valueA.localeCompare(valueB);
      }
      return nameA.localeCompare(nameB);
    });

  return pairs.map(([name, value]) => `${name}:${value}`).join("\n");
}

export function createPageFetchCacheKey(
  method: PageFetchMethod,
  url: string,
  headers: Headers,
): string {
  const headerFingerprint = serializeHeaders(headers);
  return headerFingerprint
    ? `${method} ${url} ${headerFingerprint}`
    : `${method} ${url}`;
}

export function createSharedPageFetchCacheKey(
  method: PageFetchMethod,
  url: string,
  headers: Headers,
): string {
  return `${SHARED_CACHE_PREFIX}${createPageFetchCacheKey(method, url, headers)}`;
}

export function shouldCacheFetchResponse(response: Response): boolean {
  if (!response.ok) {
    return false;
  }

  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  if (NON_CACHEABLE_DIRECTIVES.some((directive) => cacheControl.includes(directive))) {
    return false;
  }

  const vary = response.headers.get("vary")?.toLowerCase() ?? "";
  if (vary.includes("*")) {
    return false;
  }

  return true;
}

function parsePositiveSeconds(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function parseCacheControlSeconds(
  cacheControl: string,
  directive: "max-age" | "s-maxage" | "stale-while-revalidate",
): number | undefined {
  const match = cacheControl.match(new RegExp(`${directive}=([0-9]+)`));
  return match ? parsePositiveSeconds(match[1] ?? null) : undefined;
}

function parseHeaderList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0))];
}

export function resolveSharedPageFetchCachePolicy(
  url: string,
  response: Response,
): {
  cacheable: boolean;
  ttl?: number;
  revalidate?: number;
  tags: string[];
} {
  if (!shouldCacheFetchResponse(response)) {
    return { cacheable: false, tags: [] };
  }

  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  const ttl = parseCacheControlSeconds(cacheControl, "s-maxage")
    ?? parseCacheControlSeconds(cacheControl, "max-age");
  const revalidate = parsePositiveSeconds(response.headers.get(SHARED_CACHE_REVALIDATE_HEADER))
    ?? parseCacheControlSeconds(cacheControl, "stale-while-revalidate");
  const explicitTags = parseHeaderList(response.headers.get(SHARED_CACHE_TAG_HEADER));
  const explicitPaths = parseHeaderList(response.headers.get(SHARED_CACHE_PATH_HEADER))
    .map((entry) => createCachePathTag(entry));
  const tags = [...new Set([
    ...explicitTags,
    ...explicitPaths,
    createCachePathTag(url),
  ])];

  if (ttl === undefined && revalidate === undefined) {
    return { cacheable: false, tags };
  }

  return {
    cacheable: true,
    ...(ttl !== undefined ? { ttl } : {}),
    ...(revalidate !== undefined ? { revalidate } : {}),
    tags,
  };
}

export class PageFetchRequestCache {
  private settled = new Map<string, unknown>();
  private inFlight = new Map<string, Promise<unknown>>();

  has(key: string): boolean {
    return this.settled.has(key);
  }

  get<T>(key: string): T | undefined {
    if (!this.settled.has(key)) {
      return undefined;
    }

    return this.settled.get(key) as T;
  }

  set<T>(key: string, value: T): void {
    this.settled.set(key, value);
  }

  async dedupe<T>(
    key: string,
    execute: () => Promise<{ value: T; cacheable: boolean }>,
  ): Promise<T> {
    if (this.settled.has(key)) {
      return this.settled.get(key) as T;
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const task = (async () => {
      try {
        const result = await execute();
        if (result.cacheable) {
          this.settled.set(key, result.value);
        }
        return result.value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, task as Promise<unknown>);
    return task;
  }

  clear(): void {
    this.settled.clear();
    this.inFlight.clear();
  }
}

export async function readSharedPageFetchCache<T>(key: string): Promise<T | undefined> {
  const cache = await getSharedPageFetchCache();
  if (!cache?.cacheGet) {
    return undefined;
  }

  const cached = await cache.cacheGet<T>(key);
  return cached?.data;
}

export async function writeSharedPageFetchCache<T>(
  key: string,
  value: T,
  policy: {
    ttl?: number;
    revalidate?: number;
    tags: string[];
  },
): Promise<void> {
  const cache = await getSharedPageFetchCache();
  if (!cache?.cacheSet) {
    return;
  }

  await cache.cacheSet(key, value, {
    ...(policy.ttl !== undefined ? { ttl: policy.ttl } : {}),
    ...(policy.revalidate !== undefined ? { revalidate: policy.revalidate } : {}),
    tags: policy.tags,
  });
}
