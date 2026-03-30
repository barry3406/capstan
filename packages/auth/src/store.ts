/**
 * Pluggable key-value store interface.
 *
 * Identical to `@zauso-ai/capstan-core`'s `KeyValueStore` — duplicated here
 * so that `@zauso-ai/capstan-auth` has no hard dependency on the core package.
 */
export interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

/**
 * In-memory implementation of `KeyValueStore` with optional per-entry TTL.
 */
export class MemoryStore<T> implements KeyValueStore<T> {
  private data = new Map<string, { value: T; expiresAt: number | undefined }>();

  async get(key: string): Promise<T | undefined> {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    this.data.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key); // triggers TTL check
    return val !== undefined;
  }

  async keys(): Promise<string[]> {
    const now = Date.now();
    const result: string[] = [];
    for (const [key, entry] of this.data) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        this.data.delete(key);
      } else {
        result.push(key);
      }
    }
    return result;
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}
