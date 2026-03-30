import type { KeyValueStore } from "./store.js";
import { MemoryStore } from "./store.js";
import type { CapstanContext, MiddlewareDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Rate Limiting — Token-Aware Sliding Window
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Max requests per window. */
  limit: number;
  /** Window duration in seconds. */
  window: number;
  /** Separate limits by auth type. Overrides `limit` for each type. */
  byAuthType?: {
    human?: number;
    agent?: number;
    anonymous?: number;
    workload?: number;
  };
  /** Key extractor strategy (default: "ip"). */
  keyBy?: "ip" | "userId" | "apiKey";
}

/** Internal record for a sliding-window counter bucket. */
interface SlidingWindowBucket {
  /** Timestamps (ms) of requests inside the current window. */
  timestamps: number[];
}

/**
 * Pluggable store for sliding window buckets.  Defaults to in-memory.
 */
let rateLimitStore: KeyValueStore<SlidingWindowBucket> = new MemoryStore();

/**
 * Replace the default in-memory rate-limit store with a custom implementation.
 *
 * Call this at application startup before any requests are processed.
 */
export function setRateLimitStore(store: KeyValueStore<SlidingWindowBucket>): void {
  rateLimitStore = store;
}

/**
 * Extract a rate-limit key from the request/context based on the strategy.
 */
function extractKey(
  request: Request,
  ctx: CapstanContext,
  keyBy: RateLimitConfig["keyBy"],
): string {
  switch (keyBy) {
    case "userId":
      return ctx.auth.userId ?? extractIp(request);
    case "apiKey":
      return ctx.auth.agentId ?? extractIp(request);
    case "ip":
    default:
      return extractIp(request);
  }
}

/**
 * Best-effort IP extraction from the request.
 *
 * Checks common proxy headers before falling back to "unknown".
 */
function extractIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Determine the effective limit for the current request based on auth type.
 */
function effectiveLimit(config: RateLimitConfig, ctx: CapstanContext): number {
  if (config.byAuthType) {
    const typeLimit = config.byAuthType[ctx.auth.type];
    if (typeLimit !== undefined) return typeLimit;
  }
  return config.limit;
}

/**
 * Check and record a request against the sliding window.
 *
 * Returns `{ allowed, remaining, retryAfter }` where:
 * - `allowed`    – whether the request is within the limit
 * - `remaining`  – how many requests remain in this window
 * - `retryAfter` – seconds until the oldest request in the window expires
 *                   (only meaningful when `allowed` is false)
 */
async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const now = Date.now();

  let bucket = await rateLimitStore.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
  }

  // Prune expired timestamps.
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    // Oldest timestamp determines when a slot will open.
    const oldest = bucket.timestamps[0]!;
    const retryAfterMs = windowMs - (now - oldest);
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    // Persist the pruned bucket back to the store.
    await rateLimitStore.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(retryAfterSec, 1),
    };
  }

  bucket.timestamps.push(now);
  await rateLimitStore.set(key, bucket);

  return {
    allowed: true,
    remaining: limit - bucket.timestamps.length,
    retryAfter: 0,
  };
}

/**
 * Define rate-limiting middleware using an in-memory sliding window counter.
 *
 * Returns a `MiddlewareDefinition` that can be used with `defineMiddleware()`
 * or registered directly on a Capstan app.
 *
 * When the limit is exceeded the middleware responds with HTTP 429 and sets
 * the `Retry-After` header (in seconds), plus standard `X-RateLimit-*` headers
 * on every response.
 *
 * ```ts
 * import { defineRateLimit } from "@zauso-ai/capstan-core";
 *
 * const limiter = defineRateLimit({
 *   limit: 100,
 *   window: 60,
 *   byAuthType: { agent: 200, anonymous: 20 },
 *   keyBy: "ip",
 * });
 * ```
 */
export function defineRateLimit(config: RateLimitConfig): MiddlewareDefinition {
  const windowMs = config.window * 1000;

  return {
    name: "rateLimit",
    handler: async ({ request, ctx, next }) => {
      const key = extractKey(request, ctx, config.keyBy);
      const limit = effectiveLimit(config, ctx);
      const { allowed, remaining, retryAfter } = await checkRateLimit(
        key,
        limit,
        windowMs,
      );

      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: "Too Many Requests",
            retryAfter,
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(retryAfter),
              "X-RateLimit-Limit": String(limit),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(
                Math.ceil(Date.now() / 1000) + retryAfter,
              ),
            },
          },
        );
      }

      const response = await next();

      // Attach rate-limit headers to successful responses.
      // Response headers may be immutable so we construct a new response.
      const headers = new Headers(response.headers);
      headers.set("X-RateLimit-Limit", String(limit));
      headers.set("X-RateLimit-Remaining", String(remaining));
      headers.set(
        "X-RateLimit-Reset",
        String(Math.ceil(Date.now() / 1000) + config.window),
      );

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

/**
 * Clear the rate-limit store.
 *
 * Useful for tests so state does not leak between test cases.
 */
export async function clearRateLimitStore(): Promise<void> {
  await rateLimitStore.clear();
}
