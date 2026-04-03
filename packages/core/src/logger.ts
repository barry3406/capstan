import type { Context, MiddlewareHandler } from "hono";
import type { CapstanContext } from "./types.js";
import { createRequestIdentity } from "./ops.js";

export interface RequestLoggerOptions {
  ops?: CapstanContext["ops"];
}

// ---------------------------------------------------------------------------
// Log Level
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function resolveLogLevel(): LogLevel {
  const raw = (
    typeof process !== "undefined" && process.env
      ? process.env["LOG_LEVEL"]
      : "info"
  )?.toLowerCase() ?? "info";
  if (raw in LOG_LEVEL_RANK) {
    return raw as LogLevel;
  }
  return "info";
}

// ---------------------------------------------------------------------------
interface RequestLogEntry {
  ts: string;
  reqId: string;
  method: string;
  path: string;
  status: number;
  ms: number;
}

interface RequestStartLogEntry {
  ts: string;
  reqId: string;
  method: string;
  path: string;
  event: "start";
}

function shouldLogCompletion(
  level: LogLevel,
  status: number,
): boolean {
  switch (level) {
    case "debug":
    case "info":
      return true;
    case "warn":
      return status >= 400;
    case "error":
      return status >= 500;
  }
}

// ---------------------------------------------------------------------------
// createRequestLogger
// ---------------------------------------------------------------------------

/**
 * Create Hono middleware that logs structured JSON lines for every HTTP
 * request.  Each request receives a unique ID set as the `X-Request-Id`
 * response header.
 *
 * The logger respects the `LOG_LEVEL` environment variable:
 * - `debug`  -- log request start + completion
 * - `info`   -- log request completion only (default)
 * - `warn`   -- only log 4xx/5xx responses
 * - `error`  -- only log 5xx responses
 */
export function createRequestLogger(options: RequestLoggerOptions = {}): MiddlewareHandler {
  return async (c: Context, next: () => Promise<void>) => {
    const level = resolveLogLevel();
    const requestHeaderId = c.req.header("x-request-id");
    const traceHeaderId = c.req.header("x-trace-id");
    const currentRequestId = c.get("capstanRequestId") as string | undefined;
    const currentTraceId = c.get("capstanTraceId") as string | undefined;
    const requestIdentity = createRequestIdentity({
      ...(requestHeaderId ? { requestHeaderId } : {}),
      ...(traceHeaderId ? { traceHeaderId } : {}),
      ...(currentRequestId ? { requestId: currentRequestId } : {}),
      ...(currentTraceId ? { traceId: currentTraceId } : {}),
    });
    const reqId = requestIdentity.requestId;
    const traceId = requestIdentity.traceId;
    const method = c.req.method;
    const path = c.req.path;
    const start = performance.now();
    const ops = options.ops ?? (c.get("capstanOps") as CapstanContext["ops"] | undefined);

    // Set the request ID header early so downstream middleware can read it.
    c.header("X-Request-Id", reqId);
    c.header("X-Trace-Id", traceId);
    c.set("capstanRequestId", reqId);
    c.set("capstanTraceId", traceId);

    // debug: log request start
    if (level === "debug") {
      const entry: RequestStartLogEntry = {
        ts: new Date().toISOString(),
        reqId,
        method,
        path,
        event: "start",
      };
      console.log(JSON.stringify(entry));
    }

    if (ops) {
      await ops.recordRequestStart({
        requestId: reqId,
        traceId,
        data: {
          method,
          path,
          ...(c.req.header("user-agent")
            ? { userAgent: c.req.header("user-agent") as string }
            : {}),
        },
      });
    }

    try {
      await next();
    } catch (error) {
      if (ops) {
        await ops.recordRequestEnd({
          requestId: reqId,
          traceId,
          data: {
            method,
            path,
            status: 500,
            durationMs: Math.round(performance.now() - start),
          },
        });
      }
      throw error;
    }

    const ms = Math.round(performance.now() - start);
    const status = c.res.status;

    if (ops) {
      await ops.recordRequestEnd({
        requestId: reqId,
        traceId,
        data: {
          method,
          path,
          status,
          durationMs: ms,
        },
      });
    }

    if (shouldLogCompletion(level, status)) {
      const entry: RequestLogEntry = {
        ts: new Date().toISOString(),
        reqId,
        method,
        path,
        status,
        ms,
      };
      console.log(JSON.stringify(entry));
    }
  };
}
