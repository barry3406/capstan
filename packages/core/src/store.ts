/**
 * Pluggable key-value store interface.
 *
 * The default implementation (`MemoryStore`) uses an in-memory `Map` with
 * optional per-entry TTL.  Production deployments can swap in a Redis,
 * DynamoDB, or any other backend by implementing this interface.
 */
export interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
}

/**
 * In-memory implementation of `KeyValueStore` with optional per-entry TTL.
 *
 * Expired entries are lazily pruned on access — there is no background
 * cleanup timer.  This keeps the implementation simple and deterministic
 * for tests while still being suitable for development and low-traffic
 * production use.
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

  async clear(): Promise<void> {
    this.data.clear();
  }
}
