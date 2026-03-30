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
 * In-memory sliding window store.
 *
 * Keys are rate-limit identifiers (e.g. IP address, userId).  Each key maps
 * to an array of request timestamps within the current window.  Expired
 * entries are lazily pruned on every access.
 */
const store = new Map<string, SlidingWindowBucket>();

/** Periodic cleanup interval handle (lazy-started). */
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

function ensureCleanupTimer(windowMs: number): void {
  if (cleanupTimer !== undefined) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store) {
      // Remove timestamps older than the largest window we've seen.
      bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
      if (bucket.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow the process to exit even if the timer is still running.
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
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
function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();

  let bucket = store.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    store.set(key, bucket);
  }

  // Prune expired timestamps.
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    // Oldest timestamp determines when a slot will open.
    const oldest = bucket.timestamps[0]!;
    const retryAfterMs = windowMs - (now - oldest);
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(retryAfterSec, 1),
    };
  }

  bucket.timestamps.push(now);

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

  // Kick off lazy periodic cleanup using the configured window.
  ensureCleanupTimer(windowMs);

  return {
    name: "rateLimit",
    handler: async ({ request, ctx, next }) => {
      const key = extractKey(request, ctx, config.keyBy);
      const limit = effectiveLimit(config, ctx);
      const { allowed, remaining, retryAfter } = checkRateLimit(
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
 * Clear the in-memory rate-limit store.
 *
 * Useful for tests so state does not leak between test cases.
 */
export function clearRateLimitStore(): void {
  store.clear();
}
