import type {
  APIDefinition,
  APIHandlerInput,
  CapstanContext,
  RouteRateLimitConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// Per-route rate limiting (sliding window, in-memory)
// ---------------------------------------------------------------------------

interface RateLimitBucket {
  timestamps: number[];
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

/**
 * Check a per-route rate limit using an in-memory sliding window.
 *
 * Returns `{ allowed, remaining, retryAfterMs }`.
 */
export function checkRouteRateLimit(
  routeKey: string,
  clientKey: string,
  config: RouteRateLimitConfig,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const key = `${routeKey}::${clientKey}`;
  const now = Date.now();

  let bucket = rateLimitBuckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateLimitBuckets.set(key, bucket);
  }

  // Prune timestamps outside the current window.
  bucket.timestamps = bucket.timestamps.filter(
    (t) => now - t < config.window,
  );

  if (bucket.timestamps.length >= config.max) {
    const oldest = bucket.timestamps[0]!;
    const retryAfterMs = config.window - (now - oldest);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 1) };
  }

  bucket.timestamps.push(now);
  return {
    allowed: true,
    remaining: config.max - bucket.timestamps.length,
    retryAfterMs: 0,
  };
}

/** Clear all per-route rate limit buckets (useful for tests). */
export function clearRouteRateLimits(): void {
  rateLimitBuckets.clear();
}

// ---------------------------------------------------------------------------
// Input coercion — auto-convert query string values to their schema types
// ---------------------------------------------------------------------------

/**
 * Coerce string values from query parameters into the types expected by a Zod
 * schema.  Numbers, booleans, and null are converted from their string forms.
 *
 * The function is intentionally shallow — it only converts top-level values.
 * Nested objects and arrays require explicit JSON encoding in the query string.
 */
export function coerceQueryInput(
  raw: Record<string, string>,
): Record<string, unknown> {
  const coerced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    // Boolean coercion
    if (value === "true") {
      coerced[key] = true;
      continue;
    }
    if (value === "false") {
      coerced[key] = false;
      continue;
    }
    // Null coercion
    if (value === "null") {
      coerced[key] = null;
      continue;
    }
    // Numeric coercion — only if the entire string is a valid finite number
    if (value !== "" && !Number.isNaN(Number(value)) && Number.isFinite(Number(value))) {
      coerced[key] = Number(value);
      continue;
    }
    // Pass through as string
    coerced[key] = value;
  }
  return coerced;
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

/**
 * Run a handler with a timeout.  If the handler does not resolve within
 * `timeoutMs` milliseconds, the returned promise rejects with a
 * `TimeoutError`.
 *
 * The abort signal is NOT threaded into the handler — callers that need
 * cancellation should use `AbortController` at a higher level.
 */
export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Handler timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError(timeoutMs));
      }
    }, timeoutMs);

    fn().then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Deprecation header helpers
// ---------------------------------------------------------------------------

/**
 * Build the HTTP `Sunset` header value from an ISO-8601 date string.
 * Returns an HTTP-date as required by RFC 8594.
 */
export function buildSunsetHeader(isoDate: string): string {
  return new Date(isoDate).toUTCString();
}

// ---------------------------------------------------------------------------
// Structured API error
// ---------------------------------------------------------------------------

export interface StructuredAPIError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// defineAPI
// ---------------------------------------------------------------------------

/**
 * Define a typed API route handler.
 *
 * The returned definition wraps the original handler so that:
 *  1. Input is validated against the Zod `input` schema (if provided).
 *  2. `beforeHandler` hook runs (may short-circuit).
 *  3. The handler runs (with optional timeout).
 *  4. `afterHandler` hook runs (may transform output).
 *  5. `transform` runs on the final output.
 *  6. Output is validated against the Zod `output` schema (if provided).
 *
 * Error mapping via `onError` is applied if the handler (or any hook) throws.
 *
 * The definition object is also stored for introspection by the agent
 * manifest system (see `getAPIRegistry()`).
 */
export function defineAPI<TInput = unknown, TOutput = unknown>(
  def: APIDefinition<TInput, TOutput>,
): APIDefinition<TInput, TOutput> {
  const wrappedHandler = async (
    args: APIHandlerInput<TInput>,
  ): Promise<TOutput> => {
    // --- validate input ---------------------------------------------------
    let validatedInput: TInput = args.input;
    if (def.input) {
      validatedInput = def.input.parse(args.input) as TInput;
    }

    try {
      // --- beforeHandler ----------------------------------------------------
      if (def.beforeHandler) {
        const hookResult = await def.beforeHandler({
          input: validatedInput,
          ctx: args.ctx,
        });
        // If beforeHandler returns a non-void value, short-circuit.
        if (hookResult !== undefined && hookResult !== null) {
          return hookResult as TOutput;
        }
      }

      // --- run handler (with optional timeout) ------------------------------
      const runHandler = () =>
        def.handler({
          input: validatedInput,
          ctx: args.ctx,
          params: args.params,
        });

      let result: TOutput;
      if (def.timeout !== undefined && def.timeout > 0) {
        result = await withTimeout(runHandler, def.timeout);
      } else {
        result = await runHandler();
      }

      // --- afterHandler -----------------------------------------------------
      if (def.afterHandler) {
        const hookResult = await def.afterHandler({
          input: validatedInput,
          output: result,
          ctx: args.ctx,
        });
        if (hookResult !== undefined && hookResult !== null) {
          result = hookResult as TOutput;
        }
      }

      // --- transform --------------------------------------------------------
      if (def.transform) {
        result = await def.transform(result);
      }

      // --- validate output --------------------------------------------------
      if (def.output) {
        return def.output.parse(result) as TOutput;
      }

      return result;
    } catch (err: unknown) {
      // --- onError ----------------------------------------------------------
      if (def.onError) {
        const mapped = await def.onError(err, args.ctx);
        // Throw the mapped error so the server layer can return it as JSON.
        const apiError = new Error(mapped.message);
        (apiError as unknown as Record<string, unknown>)["__capstanMapped"] = mapped;
        throw apiError;
      }
      throw err;
    }
  };

  const wrapped: APIDefinition<TInput, TOutput> = {
    ...def,
    handler: wrappedHandler,
  };

  // Register for introspection.
  apiRegistry.push(wrapped as APIDefinition);

  return wrapped;
}

// ---------------------------------------------------------------------------
// Internal registry — used by createCapstanApp to build the agent manifest.
// ---------------------------------------------------------------------------

const apiRegistry: APIDefinition[] = [];

/**
 * Return all API definitions registered via `defineAPI()`.
 * Primarily consumed by `createCapstanApp` when building route metadata.
 */
export function getAPIRegistry(): ReadonlyArray<APIDefinition> {
  return apiRegistry;
}

/**
 * Clear all entries from the global API registry.
 *
 * This should be called at the start of `createCapstanApp` or between test
 * cases to prevent stale definitions from leaking across app instances,
 * hot-reload cycles, or test runs.
 */
export function clearAPIRegistry(): void {
  apiRegistry.length = 0;
}
