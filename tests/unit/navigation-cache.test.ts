import { describe, test, expect, beforeEach } from "bun:test";
import { NavigationCache } from "@zauso-ai/capstan-react/client";
import type { NavigationPayload } from "@zauso-ai/capstan-react/client";

function makePayload(url: string, overrides?: Partial<NavigationPayload>): NavigationPayload {
  return {
    url,
    layoutKey: "/",
    loaderData: null,
    componentType: "server",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic operations
// ---------------------------------------------------------------------------

describe("NavigationCache", () => {
  let cache: NavigationCache;

  beforeEach(() => {
    cache = new NavigationCache();
  });

  test("set and get a payload", () => {
    const payload = makePayload("/about");
    cache.set("/about", payload);
    expect(cache.get("/about")).toEqual(payload);
  });

  test("get returns undefined for missing entry", () => {
    expect(cache.get("/404")).toBeUndefined();
  });

  test("delete removes entry", () => {
    cache.set("/a", makePayload("/a"));
    expect(cache.delete("/a")).toBe(true);
    expect(cache.get("/a")).toBeUndefined();
  });

  test("delete returns false for missing key", () => {
    expect(cache.delete("/ghost")).toBe(false);
  });

  test("has returns true for cached, false for missing", () => {
    cache.set("/a", makePayload("/a"));
    expect(cache.has("/a")).toBe(true);
    expect(cache.has("/b")).toBe(false);
  });

  test("clear removes all entries", () => {
    cache.set("/a", makePayload("/a"));
    cache.set("/b", makePayload("/b"));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("/a")).toBeUndefined();
  });

  test("size tracks entry count", () => {
    expect(cache.size).toBe(0);
    cache.set("/a", makePayload("/a"));
    expect(cache.size).toBe(1);
    cache.set("/b", makePayload("/b"));
    expect(cache.size).toBe(2);
  });

  test("overwrite same key replaces value", () => {
    cache.set("/a", makePayload("/a", { loaderData: "v1" }));
    cache.set("/a", makePayload("/a", { loaderData: "v2" }));
    expect(cache.get("/a")!.loaderData).toBe("v2");
    expect(cache.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// LRU eviction
// ---------------------------------------------------------------------------

describe("LRU eviction", () => {
  test("evicts oldest entry when at capacity", () => {
    const cache = new NavigationCache(3);
    cache.set("/a", makePayload("/a"));
    cache.set("/b", makePayload("/b"));
    cache.set("/c", makePayload("/c"));

    // At capacity — adding a 4th should evict "/a" (oldest)
    cache.set("/d", makePayload("/d"));
    expect(cache.size).toBe(3);
    expect(cache.get("/a")).toBeUndefined();
    expect(cache.get("/b")).toBeDefined();
    expect(cache.get("/d")).toBeDefined();
  });

  test("accessing an entry makes it most-recently-used", () => {
    const cache = new NavigationCache(3);
    cache.set("/a", makePayload("/a"));
    cache.set("/b", makePayload("/b"));
    cache.set("/c", makePayload("/c"));

    // Access "/a" — now it's the most recently used
    cache.get("/a");

    // Adding a new entry should evict "/b" (now the oldest), not "/a"
    cache.set("/d", makePayload("/d"));
    expect(cache.get("/a")).toBeDefined();
    expect(cache.get("/b")).toBeUndefined();
  });

  test("overwriting an entry resets its position", () => {
    const cache = new NavigationCache(3);
    cache.set("/a", makePayload("/a"));
    cache.set("/b", makePayload("/b"));
    cache.set("/c", makePayload("/c"));

    // Overwrite "/a" — moves it to the end
    cache.set("/a", makePayload("/a", { loaderData: "updated" }));

    // Now "/b" is the oldest
    cache.set("/d", makePayload("/d"));
    expect(cache.get("/a")).toBeDefined();
    expect(cache.get("/b")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TTL
// ---------------------------------------------------------------------------

describe("TTL expiration", () => {
  test("entry expires after TTL", async () => {
    // 50ms TTL for testing
    const cache = new NavigationCache(50, 50);
    cache.set("/a", makePayload("/a"));

    // Should be available immediately
    expect(cache.get("/a")).toBeDefined();

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 60));

    expect(cache.get("/a")).toBeUndefined();
  });

  test("expired entry is removed on get", async () => {
    const cache = new NavigationCache(50, 50);
    cache.set("/a", makePayload("/a"));

    await new Promise((r) => setTimeout(r, 60));

    // Get removes it
    expect(cache.get("/a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test("has returns false for expired entry", async () => {
    const cache = new NavigationCache(50, 30);
    cache.set("/a", makePayload("/a"));
    await new Promise((r) => setTimeout(r, 40));
    expect(cache.has("/a")).toBe(false);
  });

  test("non-expired entry remains available", async () => {
    const cache = new NavigationCache(50, 200);
    cache.set("/a", makePayload("/a"));
    await new Promise((r) => setTimeout(r, 50));
    // 50ms < 200ms TTL — still valid
    expect(cache.get("/a")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("NavigationCache edge cases", () => {
  test("maxSize of 1 always keeps the latest", () => {
    const cache = new NavigationCache(1);
    cache.set("/a", makePayload("/a"));
    cache.set("/b", makePayload("/b"));
    expect(cache.size).toBe(1);
    expect(cache.get("/a")).toBeUndefined();
    expect(cache.get("/b")).toBeDefined();
  });

  test("rapid sequential sets at capacity", () => {
    const cache = new NavigationCache(3);
    for (let i = 0; i < 10; i++) {
      cache.set(`/${i}`, makePayload(`/${i}`));
    }
    expect(cache.size).toBe(3);
    // Last 3 should survive
    expect(cache.get("/7")).toBeDefined();
    expect(cache.get("/8")).toBeDefined();
    expect(cache.get("/9")).toBeDefined();
    expect(cache.get("/0")).toBeUndefined();
  });

  test("delete non-existent key after clear", () => {
    const cache = new NavigationCache();
    cache.set("/a", makePayload("/a"));
    cache.clear();
    expect(cache.delete("/a")).toBe(false);
  });

  test("get on empty cache returns undefined", () => {
    const cache = new NavigationCache();
    expect(cache.get("/any")).toBeUndefined();
  });

  test("set overwrites and resets TTL", async () => {
    const cache = new NavigationCache(50, 100);
    cache.set("/a", makePayload("/a"));
    await new Promise((r) => setTimeout(r, 60));

    // Re-set resets TTL
    cache.set("/a", makePayload("/a", { loaderData: "v2" }));
    await new Promise((r) => setTimeout(r, 60));

    // 60ms after re-set, should still be within 100ms TTL
    expect(cache.get("/a")).toBeDefined();
    expect(cache.get("/a")!.loaderData).toBe("v2");
  });

  test("has triggers LRU promotion", () => {
    const cache = new NavigationCache(3);
    cache.set("/a", makePayload("/a"));
    cache.set("/b", makePayload("/b"));
    cache.set("/c", makePayload("/c"));

    // has calls get which promotes /a
    cache.has("/a");

    // Add new entry — should evict /b (now oldest), not /a
    cache.set("/d", makePayload("/d"));
    expect(cache.get("/a")).toBeDefined();
    expect(cache.get("/b")).toBeUndefined();
  });

  test("payload with loaderData preserved through cache", () => {
    const cache = new NavigationCache();
    const complex = makePayload("/data", {
      loaderData: { users: [{ id: 1, name: "Alice" }], count: 42 },
      metadata: { title: "Data Page" },
    });
    cache.set("/data", complex);
    const retrieved = cache.get("/data")!;
    expect(retrieved.loaderData).toEqual({ users: [{ id: 1, name: "Alice" }], count: 42 });
    expect(retrieved.metadata).toEqual({ title: "Data Page" });
  });
});
