import type { NavigationPayload } from "./types.js";

/**
 * LRU cache for navigation payloads.  Avoids redundant server requests
 * when navigating back to recently-visited pages.
 *
 * - Maximum 50 entries (configurable)
 * - 5-minute TTL per entry
 * - Least-recently-used eviction when at capacity
 */

interface CacheEntry {
  payload: NavigationPayload;
  insertedAt: number;
}

const DEFAULT_MAX_SIZE = 50;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class NavigationCache {
  private entries = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = DEFAULT_MAX_SIZE, ttlMs = DEFAULT_TTL_MS) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(url: string): NavigationPayload | undefined {
    const entry = this.read(url, true);
    return entry?.payload;
  }

  set(url: string, payload: NavigationPayload): void {
    // Delete first so re-insertion moves it to the end
    this.entries.delete(url);

    // Evict oldest if at capacity
    if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }

    this.entries.set(url, { payload, insertedAt: Date.now() });
  }

  has(url: string): boolean {
    return this.read(url, true) !== undefined;
  }

  delete(url: string): boolean {
    return this.entries.delete(url);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  peek(url: string): NavigationPayload | undefined {
    return this.read(url, false)?.payload;
  }

  private read(url: string, touch: boolean): CacheEntry | undefined {
    const entry = this.entries.get(url);
    if (!entry) return undefined;

    if (Date.now() - entry.insertedAt > this.ttlMs) {
      this.entries.delete(url);
      return undefined;
    }

    if (touch) {
      this.entries.delete(url);
      this.entries.set(url, entry);
    }

    return entry;
  }
}
