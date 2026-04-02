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
});
