import type { KeyValueStore } from "./store.js";
import { MemoryStore } from "./store.js";
import {
  CacheTagIndex,
  createPageCacheKey,
  normalizeCacheTags,
} from "./cache-utils.js";

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
const tagIndex = new CacheTagIndex();

async function findKeysForTag(tag: string): Promise<string[]> {
  const keys = await store.keys();
  const matches: string[] = [];

  for (const key of keys) {
    const entry = await store.get(key);
    if (entry?.tags.includes(tag)) {
      matches.push(key);
    }
  }

  return matches;
}

async function invalidateKeys(keys: readonly string[]): Promise<number> {
  let count = 0;

  for (const key of keys) {
    const deleted = await store.delete(key);
    if (!deleted) {
      continue;
    }
    tagIndex.unregister(key);
    count++;
  }

  return count;
}

/**
 * Swap the underlying store.  Also resets the in-memory tag index because
 * the new store has no relationship with the previous one's contents.
 */
export function setResponseCacheStore(s: KeyValueStore<ResponseCacheEntry>): void {
  store = s;
  tagIndex.clear();
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
  const normalizedEntry: ResponseCacheEntry = {
    ...entry,
    tags: normalizeCacheTags(entry.tags),
  };

  // Write to the store first — if this fails, the tag index stays consistent
  // with whatever was previously stored.
  await store.set(key, normalizedEntry, opts?.ttlMs);

  // Clean up old tag references AFTER the write succeeds, then register
  // the new entry's tags.  Both operations are synchronous so no other
  // code can interleave between them.
  tagIndex.register(key, normalizedEntry.tags);
}

export async function responseCacheInvalidateTag(tag: string): Promise<number> {
  const count = await tagIndex.invalidateTag(tag, (key) => store.delete(key));
  if (count > 0) {
    return count;
  }

  const normalizedTag = normalizeCacheTags([tag])[0];
  if (!normalizedTag) {
    return 0;
  }

  return invalidateKeys(await findKeysForTag(normalizedTag));
}

export async function responseCacheInvalidatePath(url: string): Promise<boolean> {
  return responseCacheInvalidate(createPageCacheKey(url));
}

export async function responseCacheInvalidate(key: string): Promise<boolean> {
  const deleted = await store.delete(key);
  if (deleted) {
    tagIndex.unregister(key);
  }
  return deleted;
}

export async function responseCacheClear(): Promise<void> {
  await store.clear();
  tagIndex.clear();
}
