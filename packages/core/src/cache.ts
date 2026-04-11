import type { KeyValueStore } from "./store.js";
import { MemoryStore } from "./store.js";
import {
  CacheTagIndex,
  createCachePathTag,
  createCachePathTagFromKey,
  createPageCacheKey,
  normalizeCacheTags,
} from "./cache-utils.js";
import {
  responseCacheInvalidatePath,
  responseCacheInvalidateTag,
} from "./response-cache.js";

export interface CacheOptions {
  /** Time-to-live in seconds */
  ttl?: number;
  /** Cache tags for invalidation */
  tags?: string[];
  /** Revalidate interval in seconds (ISR) */
  revalidate?: number;
}

export interface CacheEntry<T> {
  data: T;
  createdAt: number;
  expiresAt?: number;
  tags: string[];
  revalidateAt?: number;
  stale: boolean;
}

let cacheStore: KeyValueStore<CacheEntry<unknown>> = new MemoryStore();
const tagIndex = new CacheTagIndex();
const inFlightComputations = new Map<string, Promise<unknown>>();

async function findKeysForTag(tag: string): Promise<string[]> {
  const keys = await cacheStore.keys();
  const matches: string[] = [];

  for (const key of keys) {
    const entry = await cacheStore.get(key);
    if (entry?.tags.includes(tag)) {
      matches.push(key);
    }
  }

  return matches;
}

async function invalidateKeys(keys: readonly string[]): Promise<number> {
  let count = 0;

  for (const key of keys) {
    const deleted = await cacheStore.delete(key);
    if (!deleted) {
      continue;
    }
    tagIndex.unregister(key);
    inFlightComputations.delete(key);
    count++;
  }

  return count;
}

async function invalidateCacheTagLocally(tag: string): Promise<number> {
  const count = await tagIndex.invalidateTag(tag, async (key) => {
    const deleted = await cacheStore.delete(key);
    if (deleted) {
      inFlightComputations.delete(key);
    }
    return deleted;
  });

  if (count > 0) {
    return count;
  }

  return invalidateKeys(await findKeysForTag(tag));
}

function normalizeSeconds(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? 0 : value;
}

export function setCacheStore(store: KeyValueStore<CacheEntry<unknown>>): void {
  cacheStore = store;
  tagIndex.clear();
  inFlightComputations.clear();
}

/**
 * Cache a value with optional TTL, tags, and ISR revalidation.
 */
export async function cacheSet<T>(key: string, data: T, opts?: CacheOptions): Promise<void> {
  const now = Date.now();
  const ttlSeconds = normalizeSeconds(opts?.ttl);
  const revalidateSeconds = normalizeSeconds(opts?.revalidate);
  const autoPathTag = createCachePathTagFromKey(key);
  const entry: CacheEntry<T> = {
    data,
    createdAt: now,
    tags: normalizeCacheTags(autoPathTag ? [...(opts?.tags ?? []), autoPathTag] : opts?.tags),
    stale: false,
  };
  if (ttlSeconds !== undefined) entry.expiresAt = now + ttlSeconds * 1000;
  if (revalidateSeconds !== undefined) entry.revalidateAt = now + revalidateSeconds * 1000;

  const ttlMs = ttlSeconds !== undefined ? ttlSeconds * 1000 : undefined;
  await cacheStore.set(key, entry as CacheEntry<unknown>, ttlMs);

  // Clean old tag references AFTER the write succeeds, then register new ones.
  tagIndex.register(key, entry.tags);
}

/**
 * Get a cached value. Returns undefined if expired or missing.
 * For ISR: returns stale data and marks for revalidation.
 */
export async function cacheGet<T>(key: string): Promise<{ data: T; stale: boolean } | undefined> {
  const entry = await cacheStore.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;

  const now = Date.now();

  // Hard expired
  if (entry.expiresAt && now > entry.expiresAt) {
    await cacheStore.delete(key);
    return undefined;
  }

  // ISR: stale but still serveable
  if (entry.revalidateAt && now > entry.revalidateAt) {
    return { data: entry.data, stale: true };
  }

  return { data: entry.data, stale: false };
}

/**
 * Invalidate all cache entries with a given tag.
 */
export async function cacheInvalidateTag(tag: string): Promise<number> {
  const count = await invalidateCacheTagLocally(tag);

  // Also invalidate the response cache so page-level ISR entries
  // tagged with the same key are evicted in a single call.
  return count + await responseCacheInvalidateTag(tag);
}

/**
 * Invalidate a specific path-backed cache entry.
 */
export async function cacheInvalidatePath(url: string): Promise<boolean> {
  const key = createPageCacheKey(url);
  const pathTag = createCachePathTag(url);
  inFlightComputations.delete(key);
  const deleted = await cacheInvalidate(key);
  const taggedCount = await invalidateCacheTagLocally(pathTag);
  const responseDeleted = await responseCacheInvalidatePath(url);
  return deleted || taggedCount > 0 || responseDeleted;
}

/**
 * Invalidate a specific cache entry.
 */
export async function cacheInvalidate(key: string): Promise<boolean> {
  const deleted = await cacheStore.delete(key);
  if (deleted) {
    tagIndex.unregister(key);
    inFlightComputations.delete(key);
  }
  return deleted;
}

/**
 * Clear all cache entries.
 */
export async function cacheClear(): Promise<void> {
  await cacheStore.clear();
  tagIndex.clear();
  inFlightComputations.clear();
}

async function runCachedComputation<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const existing = inFlightComputations.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const task = (async () => {
    try {
      return await compute();
    } finally {
      inFlightComputations.delete(key);
    }
  })();

  inFlightComputations.set(key, task as Promise<unknown>);
  return task;
}

/**
 * Decorator for caching function results.
 */
export function cached<T>(key: string, fn: () => Promise<T>, opts?: CacheOptions): Promise<T> {
  return (async () => {
    const existing = await cacheGet<T>(key);
    if (existing && !existing.stale) return existing.data;

    // Stale-while-revalidate: return stale, refresh in background
    if (existing?.stale) {
      // Fire-and-forget revalidation, but dedupe concurrent refreshes.
      void runCachedComputation(key, async () => {
        const fresh = await fn();
        await cacheSet(key, fresh, opts);
        return fresh;
      }).catch(() => {});
      return existing.data;
    }

    // Cache miss: fetch and store, deduping concurrent callers.
    return runCachedComputation(key, async () => {
      const fresh = await cacheGet<T>(key);
      if (fresh && !fresh.stale) {
        return fresh.data;
      }

      const data = await fn();
      await cacheSet(key, data, opts);
      return data;
    });
  })();
}
