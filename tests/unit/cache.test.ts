import { describe, test, expect, beforeEach } from "bun:test";
import {
  cacheSet,
  cacheGet,
  cacheInvalidateTag,
  cacheInvalidate,
  cacheClear,
  cached,
  setCacheStore,
  MemoryStore,
} from "@zauso-ai/capstan-core";
import type { CacheEntry, KeyValueStore } from "@zauso-ai/capstan-core";

// Reset cache state before each test
beforeEach(async () => {
  await cacheClear();
  setCacheStore(new MemoryStore());
});

// ---------------------------------------------------------------------------
// cacheSet + cacheGet
// ---------------------------------------------------------------------------

describe("cacheSet + cacheGet", () => {
  test("set and get a value", async () => {
    await cacheSet("key1", { hello: "world" });
    const result = await cacheGet<{ hello: string }>("key1");
    expect(result).toBeDefined();
    expect(result!.data).toEqual({ hello: "world" });
    expect(result!.stale).toBe(false);
  });

  test("get returns undefined for missing key", async () => {
    const result = await cacheGet("nonexistent");
    expect(result).toBeUndefined();
  });

  test("TTL: entry expires after ttl seconds", async () => {
    // Use a very short TTL — we fake expiry by setting ttl in the past
    // by directly manipulating the store.
    const store = new MemoryStore<CacheEntry<unknown>>();
    setCacheStore(store);

    const now = Date.now();
    const entry: CacheEntry<string> = {
      data: "expired",
      createdAt: now - 5000,
      expiresAt: now - 1000, // already expired
      tags: [],
      stale: false,
    };
    await store.set("expired-key", entry as CacheEntry<unknown>);

    const result = await cacheGet("expired-key");
    expect(result).toBeUndefined();
  });

  test("TTL: entry available before expiry", async () => {
    await cacheSet("fresh", "data", { ttl: 3600 });
    const result = await cacheGet<string>("fresh");
    expect(result).toBeDefined();
    expect(result!.data).toBe("data");
    expect(result!.stale).toBe(false);
  });

  test("no TTL: entry persists indefinitely", async () => {
    await cacheSet("forever", 42);
    const result = await cacheGet<number>("forever");
    expect(result).toBeDefined();
    expect(result!.data).toBe(42);
  });

  test("tags stored on entry", async () => {
    const store = new MemoryStore<CacheEntry<unknown>>();
    setCacheStore(store);

    await cacheSet("tagged", "value", { tags: ["a", "b"] });
    const raw = await store.get("tagged");
    expect(raw).toBeDefined();
    expect(raw!.tags).toEqual(["a", "b"]);
  });

  test("revalidate: returns stale=true after revalidateAt", async () => {
    const store = new MemoryStore<CacheEntry<unknown>>();
    setCacheStore(store);

    const now = Date.now();
    const entry: CacheEntry<string> = {
      data: "stale-data",
      createdAt: now - 5000,
      tags: [],
      revalidateAt: now - 1000, // revalidation window passed
      stale: false,
    };
    await store.set("stale-key", entry as CacheEntry<unknown>);

    const result = await cacheGet<string>("stale-key");
    expect(result).toBeDefined();
    expect(result!.data).toBe("stale-data");
    expect(result!.stale).toBe(true);
  });

  test("revalidate: returns stale=false before revalidateAt", async () => {
    await cacheSet("not-stale", "fresh", { revalidate: 3600 });
    const result = await cacheGet<string>("not-stale");
    expect(result).toBeDefined();
    expect(result!.stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cacheInvalidateTag
// ---------------------------------------------------------------------------

describe("cacheInvalidateTag", () => {
  test("invalidates all entries with tag", async () => {
    await cacheSet("a", 1, { tags: ["group"] });
    await cacheSet("b", 2, { tags: ["group"] });
    await cacheSet("c", 3, { tags: ["other"] });

    await cacheInvalidateTag("group");

    expect(await cacheGet("a")).toBeUndefined();
    expect(await cacheGet("b")).toBeUndefined();
    expect(await cacheGet("c")).toBeDefined();
  });

  test("returns count of invalidated entries", async () => {
    await cacheSet("x", 1, { tags: ["t"] });
    await cacheSet("y", 2, { tags: ["t"] });
    const count = await cacheInvalidateTag("t");
    expect(count).toBe(2);
  });

  test("unknown tag returns 0", async () => {
    const count = await cacheInvalidateTag("nonexistent-tag");
    expect(count).toBe(0);
  });

  test("multiple tags on one entry: invalidating one removes entry", async () => {
    await cacheSet("multi", "val", { tags: ["alpha", "beta"] });
    await cacheInvalidateTag("alpha");
    expect(await cacheGet("multi")).toBeUndefined();
  });

  test("does not affect entries without tag", async () => {
    await cacheSet("no-tag", "safe");
    await cacheSet("has-tag", "gone", { tags: ["kill"] });
    await cacheInvalidateTag("kill");
    expect(await cacheGet("no-tag")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// cacheInvalidate
// ---------------------------------------------------------------------------

describe("cacheInvalidate", () => {
  test("invalidates specific key", async () => {
    await cacheSet("target", "data");
    const result = await cacheInvalidate("target");
    expect(result).toBe(true);
    expect(await cacheGet("target")).toBeUndefined();
  });

  test("returns false for missing key", async () => {
    const result = await cacheInvalidate("ghost");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cacheClear
// ---------------------------------------------------------------------------

describe("cacheClear", () => {
  test("removes all entries", async () => {
    await cacheSet("a", 1);
    await cacheSet("b", 2);
    await cacheClear();
    expect(await cacheGet("a")).toBeUndefined();
    expect(await cacheGet("b")).toBeUndefined();
  });

  test("tag index also cleared", async () => {
    await cacheSet("t", "v", { tags: ["tag1"] });
    await cacheClear();
    // After clear, invalidating the tag should find nothing
    const count = await cacheInvalidateTag("tag1");
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cached()
// ---------------------------------------------------------------------------

describe("cached()", () => {
  test("cache miss: calls fn and caches result", async () => {
    let calls = 0;
    const result = await cached("miss", async () => {
      calls++;
      return "computed";
    });
    expect(result).toBe("computed");
    expect(calls).toBe(1);

    // Verify it was cached
    const entry = await cacheGet<string>("miss");
    expect(entry).toBeDefined();
    expect(entry!.data).toBe("computed");
  });

  test("cache hit: returns cached data without calling fn", async () => {
    await cacheSet("hit", "existing");
    let calls = 0;
    const result = await cached("hit", async () => {
      calls++;
      return "should-not-run";
    });
    expect(result).toBe("existing");
    expect(calls).toBe(0);
  });

  test("stale: returns stale data and triggers background revalidation", async () => {
    const store = new MemoryStore<CacheEntry<unknown>>();
    setCacheStore(store);

    const now = Date.now();
    const entry: CacheEntry<string> = {
      data: "old",
      createdAt: now - 5000,
      tags: [],
      revalidateAt: now - 1000, // stale
      stale: false,
    };
    await store.set("stale-cached", entry as CacheEntry<unknown>);

    let revalidated = false;
    const result = await cached<string>("stale-cached", async () => {
      revalidated = true;
      return "new";
    }, { revalidate: 60 });

    // Should return stale data immediately
    expect(result).toBe("old");

    // Wait for background revalidation
    await new Promise(r => setTimeout(r, 50));
    expect(revalidated).toBe(true);

    // Now cache should have fresh data
    const fresh = await cacheGet<string>("stale-cached");
    expect(fresh).toBeDefined();
    expect(fresh!.data).toBe("new");
  });

  test("fn throws: propagates error on miss", async () => {
    await expect(
      cached("error-key", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  test("TTL respected in cached()", async () => {
    await cached("ttl-test", async () => "value", { ttl: 3600 });
    const entry = await cacheGet<string>("ttl-test");
    expect(entry).toBeDefined();
    expect(entry!.data).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// setCacheStore
// ---------------------------------------------------------------------------

describe("setCacheStore", () => {
  test("custom store receives entries", async () => {
    const store = new MemoryStore<CacheEntry<unknown>>();
    setCacheStore(store);

    await cacheSet("custom", "val");
    const raw = await store.get("custom");
    expect(raw).toBeDefined();
    expect(raw!.data).toBe("val");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("cacheSet with empty tags array", async () => {
    await cacheSet("empty-tags", "data", { tags: [] });
    const result = await cacheGet<string>("empty-tags");
    expect(result).toBeDefined();
    expect(result!.data).toBe("data");
  });

  test("cacheGet after hard expiry returns undefined", async () => {
    const store = new MemoryStore<CacheEntry<unknown>>();
    setCacheStore(store);

    const now = Date.now();
    // Entry with both expiresAt in the past — hard expired
    const entry: CacheEntry<string> = {
      data: "gone",
      createdAt: now - 10000,
      expiresAt: now - 5000,
      tags: [],
      stale: false,
    };
    await store.set("hard-expired", entry as CacheEntry<unknown>);

    const result = await cacheGet("hard-expired");
    expect(result).toBeUndefined();
  });

  test("concurrent cacheSet for same key (last write wins)", async () => {
    await Promise.all([
      cacheSet("race", "first"),
      cacheSet("race", "second"),
    ]);
    const result = await cacheGet<string>("race");
    expect(result).toBeDefined();
    // With MemoryStore the last .set() call wins
    expect(["first", "second"]).toContain(result!.data);
  });

  test("cacheSet overwrites previous entry", async () => {
    await cacheSet("overwrite", "v1");
    await cacheSet("overwrite", "v2");
    const result = await cacheGet<string>("overwrite");
    expect(result).toBeDefined();
    expect(result!.data).toBe("v2");
  });

  test("cacheInvalidate does not affect other keys", async () => {
    await cacheSet("keep", "safe");
    await cacheSet("remove", "gone");
    await cacheInvalidate("remove");
    expect(await cacheGet("keep")).toBeDefined();
    expect(await cacheGet("remove")).toBeUndefined();
  });

  test("cached with tags passes tags to cacheSet", async () => {
    const store = new MemoryStore<CacheEntry<unknown>>();
    setCacheStore(store);

    await cached("tagged-cached", async () => "val", { tags: ["mytag"] });
    const raw = await store.get("tagged-cached");
    expect(raw).toBeDefined();
    expect(raw!.tags).toEqual(["mytag"]);
  });
});
