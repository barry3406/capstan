import { describe, test, expect, beforeEach } from "bun:test";
import {
  responseCacheGet,
  responseCacheSet,
  responseCacheInvalidateTag,
  responseCacheInvalidatePath,
  responseCacheInvalidate,
  responseCacheClear,
  setResponseCacheStore,
  MemoryStore,
} from "@zauso-ai/capstan-core";
import type { ResponseCacheEntry, KeyValueStore } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<ResponseCacheEntry>): ResponseCacheEntry {
  return {
    html: "<html><body>hello</body></html>",
    headers: { "content-type": "text/html" },
    statusCode: 200,
    createdAt: Date.now(),
    revalidateAfter: null,
    tags: [],
    ...overrides,
  };
}

/**
 * A store that throws on `set()` to verify tag-index consistency
 * when the underlying write fails.
 */
class FailOnSetStore extends MemoryStore<ResponseCacheEntry> {
  async set(): Promise<void> {
    throw new Error("Simulated store write failure");
  }
}

/**
 * A store that throws on `delete()` to verify invalidation robustness.
 */
class FailOnDeleteStore extends MemoryStore<ResponseCacheEntry> {
  async delete(): Promise<boolean> {
    throw new Error("Simulated store delete failure");
  }
}

// Reset state before each test — both store contents and tag index.
beforeEach(async () => {
  await responseCacheClear();
  setResponseCacheStore(new MemoryStore<ResponseCacheEntry>());
});

// ---------------------------------------------------------------------------
// responseCacheSet + responseCacheGet
// ---------------------------------------------------------------------------

describe("responseCacheSet + responseCacheGet", () => {
  test("round-trip: all fields intact after store/retrieve", async () => {
    const entry = makeEntry({
      tags: ["x"],
      statusCode: 201,
      revalidateAfter: Date.now() + 60_000,
      headers: { "x-custom": "value" },
    });
    await responseCacheSet("page:/", entry);

    const result = await responseCacheGet("page:/");
    expect(result).toBeDefined();
    expect(result!.stale).toBe(false);
    expect(result!.entry.html).toBe(entry.html);
    expect(result!.entry.statusCode).toBe(201);
    expect(result!.entry.tags).toEqual(["x"]);
    expect(result!.entry.headers).toEqual({ "x-custom": "value" });
    expect(result!.entry.revalidateAfter).toBe(entry.revalidateAfter);
    expect(result!.entry.createdAt).toBe(entry.createdAt);
  });

  test("tags are normalized and deduplicated on write", async () => {
    await responseCacheSet("page:/tags", makeEntry({ tags: ["  x  ", "x", "y", ""] }));

    const result = await responseCacheGet("page:/tags");
    expect(result).toBeDefined();
    expect(result!.entry.tags).toEqual(["x", "y"]);
  });

  test("returns undefined for missing key", async () => {
    expect(await responseCacheGet("page:/404")).toBeUndefined();
  });

  test("stale when revalidateAfter is in the past", async () => {
    await responseCacheSet("k", makeEntry({ revalidateAfter: Date.now() - 1 }));
    const result = await responseCacheGet("k");
    expect(result).toBeDefined();
    expect(result!.stale).toBe(true);
    // Stale entries are still returned (stale-while-revalidate semantics)
    expect(result!.entry.html).toBe("<html><body>hello</body></html>");
  });

  test("revalidateAfter=0 means immediately stale on next read", async () => {
    // revalidateAfter = Date.now() means "stale after this instant",
    // so a subsequent read should find it stale.
    const now = Date.now();
    await responseCacheSet("k", makeEntry({ revalidateAfter: now }));
    // Wait 1ms to ensure Date.now() > revalidateAfter
    await new Promise((r) => setTimeout(r, 2));
    const result = await responseCacheGet("k");
    expect(result).toBeDefined();
    expect(result!.stale).toBe(true);
  });

  test("fresh when revalidateAfter is in the future", async () => {
    await responseCacheSet("k", makeEntry({ revalidateAfter: Date.now() + 60_000 }));
    expect((await responseCacheGet("k"))!.stale).toBe(false);
  });

  test("revalidateAfter=null means never stale", async () => {
    await responseCacheSet("k", makeEntry({ revalidateAfter: null }));
    expect((await responseCacheGet("k"))!.stale).toBe(false);
  });

  test("overwrite same key replaces all content", async () => {
    await responseCacheSet("k", makeEntry({ html: "v1", statusCode: 200 }));
    await responseCacheSet("k", makeEntry({ html: "v2", statusCode: 404 }));
    const result = (await responseCacheGet("k"))!;
    expect(result.entry.html).toBe("v2");
    expect(result.entry.statusCode).toBe(404);
  });

  test("overwrite with different tags: old tag no longer references key", async () => {
    await responseCacheSet("k", makeEntry({ tags: ["old-tag"] }));
    await responseCacheSet("k", makeEntry({ tags: ["new-tag"] }));

    // Invalidating the OLD tag should NOT remove the key
    await responseCacheInvalidateTag("old-tag");
    expect(await responseCacheGet("k")).toBeDefined();

    // Invalidating the NEW tag SHOULD remove it
    const count = await responseCacheInvalidateTag("new-tag");
    expect(count).toBe(1);
    expect(await responseCacheGet("k")).toBeUndefined();
  });

  test("overwrite with overlapping tags: shared tag still works", async () => {
    await responseCacheSet("k", makeEntry({ tags: ["keep", "old"] }));
    await responseCacheSet("k", makeEntry({ tags: ["keep", "new"] }));

    // "old" should no longer reference "k"
    expect(await responseCacheInvalidateTag("old")).toBe(0);
    expect(await responseCacheGet("k")).toBeDefined();

    // "keep" (shared between old and new tags) should still reference "k"
    expect(await responseCacheInvalidateTag("keep")).toBe(1);
    expect(await responseCacheGet("k")).toBeUndefined();
  });

  test("TTL: entry disappears after MemoryStore ttl expires", async () => {
    const store = new MemoryStore<ResponseCacheEntry>();
    setResponseCacheStore(store);

    // Insert directly with an already-expired TTL
    await store.set("expired", makeEntry(), -1);
    expect(await responseCacheGet("expired")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// responseCacheInvalidateTag
// ---------------------------------------------------------------------------

describe("responseCacheInvalidateTag", () => {
  test("invalidates all entries with tag, returns correct count", async () => {
    await responseCacheSet("a", makeEntry({ tags: ["posts"] }));
    await responseCacheSet("b", makeEntry({ tags: ["posts", "users"] }));
    await responseCacheSet("c", makeEntry({ tags: ["users"] }));

    const count = await responseCacheInvalidateTag("posts");
    expect(count).toBe(2);

    expect(await responseCacheGet("a")).toBeUndefined();
    expect(await responseCacheGet("b")).toBeUndefined();
    expect(await responseCacheGet("c")).toBeDefined();
  });

  test("unknown tag returns 0", async () => {
    expect(await responseCacheInvalidateTag("ghost")).toBe(0);
  });

  test("trims tag input before invalidating", async () => {
    await responseCacheSet("trimmed", makeEntry({ tags: ["topic"] }));
    expect(await responseCacheInvalidateTag("  topic  ")).toBe(1);
    expect(await responseCacheGet("trimmed")).toBeUndefined();
  });

  test("invalidating one tag does not affect entries with other tags only", async () => {
    await responseCacheSet("safe", makeEntry({ tags: ["keep"] }));
    await responseCacheSet("gone", makeEntry({ tags: ["kill"] }));
    await responseCacheInvalidateTag("kill");
    expect(await responseCacheGet("safe")).toBeDefined();
  });

  test("multi-tag entry: invalidating one tag removes entry AND cleans all its tags", async () => {
    await responseCacheSet("multi", makeEntry({ tags: ["alpha", "beta"] }));
    await responseCacheInvalidateTag("alpha");
    expect(await responseCacheGet("multi")).toBeUndefined();

    // The "beta" tag should no longer reference the deleted key
    const count = await responseCacheInvalidateTag("beta");
    expect(count).toBe(0);
  });

  test("calling twice for the same tag returns 0 on second call", async () => {
    await responseCacheSet("x", makeEntry({ tags: ["once"] }));
    expect(await responseCacheInvalidateTag("once")).toBe(1);
    expect(await responseCacheInvalidateTag("once")).toBe(0);
  });

  test("three entries share a tag: invalidation removes all three", async () => {
    await responseCacheSet("a", makeEntry({ tags: ["shared"] }));
    await responseCacheSet("b", makeEntry({ tags: ["shared"] }));
    await responseCacheSet("c", makeEntry({ tags: ["shared"] }));

    expect(await responseCacheInvalidateTag("shared")).toBe(3);
    expect(await responseCacheGet("a")).toBeUndefined();
    expect(await responseCacheGet("b")).toBeUndefined();
    expect(await responseCacheGet("c")).toBeUndefined();
  });

  test("falls back to store scanning when the in-memory tag index is empty", async () => {
    const store = new MemoryStore<ResponseCacheEntry>();
    await store.set("page:/remote", makeEntry({ tags: ["remote"] }));
    setResponseCacheStore(store);

    expect(await responseCacheInvalidateTag("remote")).toBe(1);
    expect(await responseCacheGet("page:/remote")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// responseCacheInvalidate (single key)
// ---------------------------------------------------------------------------

describe("responseCacheInvalidate", () => {
  test("deletes specific key and cleans tag index", async () => {
    await responseCacheSet("k", makeEntry({ tags: ["t1"] }));
    expect(await responseCacheInvalidate("k")).toBe(true);
    expect(await responseCacheGet("k")).toBeUndefined();

    // Tag index should be cleaned — invalidating tag finds nothing
    expect(await responseCacheInvalidateTag("t1")).toBe(0);
  });

  test("returns false for missing key", async () => {
    expect(await responseCacheInvalidate("nope")).toBe(false);
  });

  test("does not affect other keys", async () => {
    await responseCacheSet("keep", makeEntry());
    await responseCacheSet("drop", makeEntry());
    await responseCacheInvalidate("drop");
    expect(await responseCacheGet("keep")).toBeDefined();
  });

  test("invalidate then re-set: entry comes back fresh", async () => {
    await responseCacheSet("k", makeEntry({ html: "v1", tags: ["t"] }));
    await responseCacheInvalidate("k");
    await responseCacheSet("k", makeEntry({ html: "v2", tags: ["t"] }));

    const result = await responseCacheGet("k");
    expect(result).toBeDefined();
    expect(result!.entry.html).toBe("v2");

    // Tag should now reference the new entry
    expect(await responseCacheInvalidateTag("t")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// responseCacheInvalidatePath
// ---------------------------------------------------------------------------

describe("responseCacheInvalidatePath", () => {
  test("normalizes full URLs before invalidating page cache entries", async () => {
    await responseCacheSet("page:/docs", makeEntry({ tags: ["docs"] }));

    expect(
      await responseCacheInvalidatePath("https://example.com/docs?preview=1#top"),
    ).toBe(true);
    expect(await responseCacheGet("page:/docs")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// responseCacheClear
// ---------------------------------------------------------------------------

describe("responseCacheClear", () => {
  test("removes all entries", async () => {
    await responseCacheSet("a", makeEntry());
    await responseCacheSet("b", makeEntry());
    await responseCacheClear();
    expect(await responseCacheGet("a")).toBeUndefined();
    expect(await responseCacheGet("b")).toBeUndefined();
  });

  test("tag index is also cleared", async () => {
    await responseCacheSet("t", makeEntry({ tags: ["tag1"] }));
    await responseCacheClear();
    expect(await responseCacheInvalidateTag("tag1")).toBe(0);
  });

  test("clear is idempotent", async () => {
    await responseCacheClear();
    await responseCacheClear();
    // No error, no entries
    expect(await responseCacheGet("anything")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setResponseCacheStore
// ---------------------------------------------------------------------------

describe("setResponseCacheStore", () => {
  test("custom store receives entries", async () => {
    const store = new MemoryStore<ResponseCacheEntry>();
    setResponseCacheStore(store);

    await responseCacheSet("custom", makeEntry({ html: "hello" }));
    const raw = await store.get("custom");
    expect(raw).toBeDefined();
    expect(raw!.html).toBe("hello");
  });

  test("switching store resets tag index", async () => {
    await responseCacheSet("old", makeEntry({ tags: ["t"] }));

    // Switch to a new empty store
    setResponseCacheStore(new MemoryStore<ResponseCacheEntry>());

    // The tag from the previous store should not be reachable
    expect(await responseCacheInvalidateTag("t")).toBe(0);
    expect(await responseCacheGet("old")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tag index consistency under store failure
// ---------------------------------------------------------------------------

describe("tag index consistency", () => {
  test("failed store.set does NOT corrupt tag index", async () => {
    // Switch to a store that always fails on writes
    setResponseCacheStore(new FailOnSetStore());

    try {
      await responseCacheSet("new-key", makeEntry({ tags: ["new-tag"] }));
    } catch {
      // Expected: store write failed
    }

    // The failed write should NOT have registered the tag in the index
    expect(await responseCacheInvalidateTag("new-tag")).toBe(0);
  });

  test("successful writes after a failed write still work correctly", async () => {
    // Use a store that can be toggled
    let shouldFail = true;
    const store = new MemoryStore<ResponseCacheEntry>();
    const originalSet = store.set.bind(store);
    store.set = async (key: string, value: ResponseCacheEntry, ttl?: number) => {
      if (shouldFail) throw new Error("Temporary failure");
      return originalSet(key, value, ttl);
    };
    setResponseCacheStore(store);

    // First write fails
    try {
      await responseCacheSet("k", makeEntry({ tags: ["t"] }));
    } catch {
      // Expected
    }

    // Second write succeeds
    shouldFail = false;
    await responseCacheSet("k", makeEntry({ tags: ["t"] }));
    expect(await responseCacheGet("k")).toBeDefined();
    expect(await responseCacheInvalidateTag("t")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("empty tags array works without error", async () => {
    await responseCacheSet("no-tags", makeEntry({ tags: [] }));
    expect(await responseCacheGet("no-tags")).toBeDefined();
  });

  test("empty HTML string is stored and retrieved", async () => {
    await responseCacheSet("empty", makeEntry({ html: "" }));
    const result = await responseCacheGet("empty");
    expect(result!.entry.html).toBe("");
  });

  test("concurrent writes to same key settle consistently", async () => {
    // Both writes should succeed; the final state is one of the two values.
    await Promise.all([
      responseCacheSet("race", makeEntry({ html: "A" })),
      responseCacheSet("race", makeEntry({ html: "B" })),
    ]);
    const result = await responseCacheGet("race");
    expect(result).toBeDefined();
    expect(["A", "B"]).toContain(result!.entry.html);
  });

  test("many tags on a single entry all work", async () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    await responseCacheSet("k", makeEntry({ tags }));

    // Invalidating any single tag removes the entry
    expect(await responseCacheInvalidateTag("tag-5")).toBe(1);
    expect(await responseCacheGet("k")).toBeUndefined();

    // All other tags are cleaned (no dangling references)
    for (const tag of tags) {
      expect(await responseCacheInvalidateTag(tag)).toBe(0);
    }
  });

  test("set after invalidate re-creates entry", async () => {
    await responseCacheSet("k", makeEntry({ html: "v1" }));
    await responseCacheInvalidate("k");
    await responseCacheSet("k", makeEntry({ html: "v2" }));
    expect((await responseCacheGet("k"))!.entry.html).toBe("v2");
  });

  test("special characters in key names", async () => {
    const key = "page:/posts/[id]?q=hello&sort=asc#fragment";
    await responseCacheSet(key, makeEntry({ html: "special" }));
    const result = await responseCacheGet(key);
    expect(result).toBeDefined();
    expect(result!.entry.html).toBe("special");
  });
});
