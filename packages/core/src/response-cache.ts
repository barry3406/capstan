import type { KeyValueStore } from "./store.js";
import { MemoryStore } from "./store.js";

export interface ResponseCacheEntry {
  html: string;
  headers: Record<string, string>;
  statusCode: number;
  createdAt: number;
  /** Epoch ms after which the entry is stale (null = never stale) */
  revalidateAfter: number | null;
  tags: string[];
}

let store: KeyValueStore<ResponseCacheEntry> = new MemoryStore();
let tagIndex = new Map<string, Set<string>>();

/**
 * Swap the underlying store.  Also resets the in-memory tag index because
 * the new store has no relationship with the previous one's contents.
 */
export function setResponseCacheStore(s: KeyValueStore<ResponseCacheEntry>): void {
  store = s;
  tagIndex = new Map();
}

export async function responseCacheGet(
  key: string,
): Promise<{ entry: ResponseCacheEntry; stale: boolean } | undefined> {
  const entry = await store.get(key);
  if (!entry) return undefined;

  const now = Date.now();

  if (entry.revalidateAfter !== null && now > entry.revalidateAfter) {
    return { entry, stale: true };
  }

  return { entry, stale: false };
}

export async function responseCacheSet(
  key: string,
  entry: ResponseCacheEntry,
  opts?: { ttlMs?: number },
): Promise<void> {
  // Write to the store first — if this fails, the tag index stays consistent
  // with whatever was previously stored.
  await store.set(key, entry, opts?.ttlMs);

  // Clean up old tag references AFTER the write succeeds, then register
  // the new entry's tags.  Both operations are synchronous so no other
  // code can interleave between them.
  removeKeyFromTagIndex(key);
  for (const tag of entry.tags) {
    let keys = tagIndex.get(tag);
    if (!keys) {
      keys = new Set();
      tagIndex.set(tag, keys);
    }
    keys.add(key);
  }
}

export async function responseCacheInvalidateTag(tag: string): Promise<number> {
  const keys = tagIndex.get(tag);
  if (!keys || keys.size === 0) return 0;

  let count = 0;
  for (const key of keys) {
    if (await store.delete(key)) {
      // Also remove this key from any *other* tags it belongs to,
      // so the index stays consistent.
      removeKeyFromTagIndex(key);
      count++;
    }
  }
  // The tag set itself may already be empty after removeKeyFromTagIndex
  // cleaned it up, but ensure it's gone.
  tagIndex.delete(tag);
  return count;
}

export async function responseCacheInvalidate(key: string): Promise<boolean> {
  const deleted = await store.delete(key);
  if (deleted) {
    removeKeyFromTagIndex(key);
  }
  return deleted;
}

export async function responseCacheClear(): Promise<void> {
  await store.clear();
  tagIndex.clear();
}

// ── internal ──────────────────────────────────────────────────────────────

/**
 * Remove a key from every tag set in the index.  Cleans up empty tag sets.
 */
function removeKeyFromTagIndex(key: string): void {
  for (const [tag, keys] of tagIndex) {
    keys.delete(key);
    if (keys.size === 0) tagIndex.delete(tag);
  }
}
