import type { KeyValueStore } from "./store.js";
import { MemoryStore } from "./store.js";

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
const tagIndex = new Map<string, Set<string>>(); // tag -> cache keys

export function setCacheStore(store: KeyValueStore<CacheEntry<unknown>>): void {
  cacheStore = store;
}

/**
 * Cache a value with optional TTL, tags, and ISR revalidation.
 */
export async function cacheSet<T>(key: string, data: T, opts?: CacheOptions): Promise<void> {
  const now = Date.now();
  const entry: CacheEntry<T> = {
    data,
    createdAt: now,
    tags: opts?.tags ?? [],
    stale: false,
  };
  if (opts?.ttl) entry.expiresAt = now + opts.ttl * 1000;
  if (opts?.revalidate) entry.revalidateAt = now + opts.revalidate * 1000;

  const ttlMs = opts?.ttl ? opts.ttl * 1000 : undefined;
  await cacheStore.set(key, entry as CacheEntry<unknown>, ttlMs);

  // Update tag index
  for (const tag of entry.tags) {
    if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
    tagIndex.get(tag)!.add(key);
  }
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
  const keys = tagIndex.get(tag);
  if (!keys) return 0;

  let count = 0;
  for (const key of keys) {
    if (await cacheStore.delete(key)) count++;
  }
  tagIndex.delete(tag);
  return count;
}

/**
 * Invalidate a specific cache entry.
 */
export async function cacheInvalidate(key: string): Promise<boolean> {
  return cacheStore.delete(key);
}

/**
 * Clear all cache entries.
 */
export async function cacheClear(): Promise<void> {
  await cacheStore.clear();
  tagIndex.clear();
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
      // Fire-and-forget revalidation
      fn().then(fresh => cacheSet(key, fresh, opts)).catch(() => {});
      return existing.data;
    }

    // Cache miss: fetch and store
    const data = await fn();
    await cacheSet(key, data, opts);
    return data;
  })();
}
