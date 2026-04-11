import type { KeyValueStore } from "./store.js";

/**
 * Redis-backed implementation of `KeyValueStore`.
 *
 * Uses `ioredis` (an optional peer dependency) for communication with
 * Redis.  The constructor accepts any `ioredis`-compatible client instance
 * so that callers can configure connection details, clustering, and
 * Sentinel support externally.
 *
 * All keys are prefixed with a configurable namespace (default `"capstan:"`)
 * to avoid collisions when multiple applications share a Redis instance.
 *
 * ```ts
 * import Redis from "ioredis";
 * import { RedisStore } from "@zauso-ai/capstan-core";
 *
 * const redis = new Redis();
 * const store = new RedisStore(redis, "myapp:");
 * ```
 */
export class RedisStore<T> implements KeyValueStore<T> {
  private prefix: string;
  // Typed as `any` to avoid requiring ioredis as a hard dependency.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redis: any;

  constructor(redis: any, prefix: string = "capstan:") {
    this.redis = redis;
    this.prefix = prefix;
  }

  async get(key: string): Promise<T | undefined> {
    const val: string | null = await this.redis.get(this.prefix + key);
    return val ? (JSON.parse(val) as T) : undefined;
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlMs) {
      await this.redis.set(this.prefix + key, serialized, "PX", ttlMs);
    } else {
      await this.redis.set(this.prefix + key, serialized);
    }
  }

  async delete(key: string): Promise<boolean> {
    return (await this.redis.del(this.prefix + key) as number) > 0;
  }

  async has(key: string): Promise<boolean> {
    return (await this.redis.exists(this.prefix + key) as number) === 1;
  }

  async keys(): Promise<string[]> {
    const rawKeys: string[] = await this.redis.keys(this.prefix + "*");
    return rawKeys.map((k: string) => k.slice(this.prefix.length));
  }

  async clear(): Promise<void> {
    const allKeys: string[] = await this.redis.keys(this.prefix + "*");
    if (allKeys.length > 0) {
      await this.redis.del(...allKeys);
    }
  }
}
