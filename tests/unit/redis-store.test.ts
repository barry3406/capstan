import { describe, it, expect, beforeEach } from "bun:test";
import { RedisStore } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Mock Redis client
// ---------------------------------------------------------------------------

function createMockRedis() {
  const data = new Map<string, { value: string; expireAt?: number }>();
  return {
    get: async (key: string) => {
      const e = data.get(key);
      if (!e) return null;
      if (e.expireAt && Date.now() > e.expireAt) {
        data.delete(key);
        return null;
      }
      return e.value;
    },
    set: async (key: string, value: string, ...args: unknown[]) => {
      const entry: { value: string; expireAt?: number } = { value };
      if (args[0] === "PX") entry.expireAt = Date.now() + (args[1] as number);
      data.set(key, entry);
      return "OK";
    },
    del: async (...keys: string[]) => {
      let c = 0;
      for (const k of keys) if (data.delete(k)) c++;
      return c;
    },
    exists: async (key: string) => (data.has(key) ? 1 : 0),
    keys: async (pattern: string) => {
      const prefix = pattern.replace("*", "");
      return [...data.keys()].filter(k => k.startsWith(prefix));
    },
    /** expose internal data for test assertions */
    _data: data,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RedisStore", () => {
  let redis: ReturnType<typeof createMockRedis>;
  let store: InstanceType<typeof RedisStore<unknown>>;

  beforeEach(() => {
    redis = createMockRedis();
    store = new RedisStore(redis, "test:");
  });

  // ---- get ----------------------------------------------------------------

  it("get returns undefined for missing key", async () => {
    const val = await store.get("nonexistent");
    expect(val).toBeUndefined();
  });

  // ---- set + get ----------------------------------------------------------

  it("set + get stores and retrieves value (JSON serialized)", async () => {
    await store.set("greeting", "hello");
    const val = await store.get("greeting");
    expect(val).toBe("hello");
    // Verify the raw value in Redis is JSON-serialized
    const raw = await redis.get("test:greeting");
    expect(raw).toBe('"hello"');
  });

  it("complex objects (nested JSON) roundtrip correctly", async () => {
    const obj = {
      users: [{ id: 1, name: "Alice", tags: ["admin", "active"] }],
      meta: { page: 1, total: 100, nested: { deep: true } },
    };
    await store.set("complex", obj);
    const retrieved = await store.get("complex");
    expect(retrieved).toEqual(obj);
  });

  // ---- TTL ----------------------------------------------------------------

  it("set with TTL stores entry that can be retrieved before expiry", async () => {
    await store.set("temp", "value", 60_000);
    const val = await store.get("temp");
    expect(val).toBe("value");
  });

  it("set with TTL expires after time", async () => {
    // Use a TTL of 1ms and wait briefly
    await store.set("ephemeral", "gone", 1);
    // Wait just enough for the TTL to expire
    await new Promise(r => setTimeout(r, 5));
    const val = await store.get("ephemeral");
    expect(val).toBeUndefined();
  });

  // ---- delete -------------------------------------------------------------

  it("delete removes key and returns true", async () => {
    await store.set("to-delete", "val");
    const result = await store.delete("to-delete");
    expect(result).toBe(true);
    const val = await store.get("to-delete");
    expect(val).toBeUndefined();
  });

  it("delete missing key returns false", async () => {
    const result = await store.delete("nope");
    expect(result).toBe(false);
  });

  // ---- has ----------------------------------------------------------------

  it("has returns true for existing key", async () => {
    await store.set("exists", 42);
    expect(await store.has("exists")).toBe(true);
  });

  it("has returns false for missing key", async () => {
    expect(await store.has("missing")).toBe(false);
  });

  // ---- keys ---------------------------------------------------------------

  it("keys returns all keys with prefix stripped", async () => {
    await store.set("a", 1);
    await store.set("b", 2);
    await store.set("c", 3);
    const keys = await store.keys();
    expect(keys.sort()).toEqual(["a", "b", "c"]);
  });

  it("keys returns empty array when no keys match", async () => {
    const keys = await store.keys();
    expect(keys).toEqual([]);
  });

  // ---- clear --------------------------------------------------------------

  it("clear removes all prefixed keys", async () => {
    await store.set("x", 1);
    await store.set("y", 2);
    await store.clear();
    const keys = await store.keys();
    expect(keys).toEqual([]);
    expect(await store.get("x")).toBeUndefined();
  });

  it("clear on empty store does not throw", async () => {
    await store.clear();
    const keys = await store.keys();
    expect(keys).toEqual([]);
  });

  // ---- prefix isolation ---------------------------------------------------

  it("two stores with different prefixes do not interfere", async () => {
    const storeA = new RedisStore(redis, "app1:");
    const storeB = new RedisStore(redis, "app2:");

    await storeA.set("key", "fromA");
    await storeB.set("key", "fromB");

    expect(await storeA.get("key")).toBe("fromA");
    expect(await storeB.get("key")).toBe("fromB");

    await storeA.delete("key");
    expect(await storeA.get("key")).toBeUndefined();
    expect(await storeB.get("key")).toBe("fromB");
  });

  it("clear only removes keys with the store's own prefix", async () => {
    const storeA = new RedisStore(redis, "ns1:");
    const storeB = new RedisStore(redis, "ns2:");

    await storeA.set("shared", "a-val");
    await storeB.set("shared", "b-val");

    await storeA.clear();

    expect(await storeA.get("shared")).toBeUndefined();
    expect(await storeB.get("shared")).toBe("b-val");
  });

  // ---- default prefix -----------------------------------------------------

  it("uses 'capstan:' as default prefix", async () => {
    const defaultStore = new RedisStore(redis);
    await defaultStore.set("foo", "bar");
    const raw = await redis.get("capstan:foo");
    expect(raw).toBe('"bar"');
  });
});
