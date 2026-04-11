import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineAPI,
  clearAPIRegistry,
  definePolicy,
  enforcePolicies,
  composePolicy,
  definePolicyGroup,
  applyPolicyGroup,
  getPolicyAuditLog,
  clearPolicyAuditLog,
  denyWithCode,
  allowResult,
  createCapstanApp,
  coerceQueryInput,
  withTimeout,
  TimeoutError,
  buildSunsetHeader,
  checkRouteRateLimit,
  clearRouteRateLimits,
} from "@zauso-ai/capstan-core";
import type {
  CapstanContext,
  PolicyDefinition,
} from "@zauso-ai/capstan-core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeContext(overrides?: Partial<CapstanContext>): CapstanContext {
  return {
    auth: { isAuthenticated: false, type: "anonymous", permissions: [] },
    request: new Request("http://localhost/test"),
    env: {},
    honoCtx: {} as CapstanContext["honoCtx"],
    ...overrides,
  };
}

function makePolicy(
  key: string,
  effect: "allow" | "deny" | "approve" | "redact",
  opts?: { priority?: number; reason?: string; code?: string; when?: PolicyDefinition["when"] },
): PolicyDefinition {
  return definePolicy({
    key,
    title: `Test ${key}`,
    effect,
    priority: opts?.priority,
    when: opts?.when,
    async check() {
      const result: { effect: typeof effect; reason?: string; code?: string } = { effect };
      if (opts?.reason !== undefined) result.reason = opts.reason;
      if (opts?.code !== undefined) result.code = opts.code;
      return result;
    },
  });
}

// ---------------------------------------------------------------------------
// defineAPI — new features
// ---------------------------------------------------------------------------

describe("defineAPI — timeout", () => {
  beforeEach(() => clearAPIRegistry());

  it("completes normally when handler finishes within timeout", async () => {
    const api = defineAPI({
      timeout: 5000,
      async handler() {
        return { ok: true };
      },
    });

    const result = await api.handler({
      input: undefined,
      ctx: makeFakeContext(),
      params: {},
    });
    expect(result).toEqual({ ok: true });
  });

  it("throws TimeoutError when handler exceeds timeout", async () => {
    const api = defineAPI({
      timeout: 50,
      async handler() {
        await new Promise((r) => setTimeout(r, 200));
        return { ok: true };
      },
    });

    try {
      await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
      expect((err as TimeoutError).timeoutMs).toBe(50);
    }
  });
});

describe("defineAPI — deprecated", () => {
  beforeEach(() => clearAPIRegistry());

  it("stores deprecation metadata on the definition", () => {
    const api = defineAPI({
      deprecated: { sunset: "2026-12-01", message: "Use /v2 instead" },
      async handler() {
        return {};
      },
    });
    expect(api.deprecated?.sunset).toBe("2026-12-01");
    expect(api.deprecated?.message).toBe("Use /v2 instead");
  });
});

describe("defineAPI — rateLimit", () => {
  beforeEach(() => {
    clearAPIRegistry();
    clearRouteRateLimits();
  });

  it("stores rate limit config on the definition", () => {
    const api = defineAPI({
      rateLimit: { window: 60_000, max: 100 },
      async handler() {
        return {};
      },
    });
    expect(api.rateLimit?.window).toBe(60_000);
    expect(api.rateLimit?.max).toBe(100);
  });
});

describe("defineAPI — beforeHandler", () => {
  beforeEach(() => clearAPIRegistry());

  it("runs beforeHandler before the main handler", async () => {
    const order: string[] = [];
    const api = defineAPI({
      beforeHandler: async () => {
        order.push("before");
      },
      async handler() {
        order.push("handler");
        return { ok: true };
      },
    });
    await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
    expect(order).toEqual(["before", "handler"]);
  });

  it("short-circuits when beforeHandler returns a value", async () => {
    const api = defineAPI({
      beforeHandler: async () => {
        return { shortCircuited: true };
      },
      async handler() {
        return { shortCircuited: false };
      },
    });
    const result = await api.handler({
      input: undefined,
      ctx: makeFakeContext(),
      params: {},
    });
    expect(result).toEqual({ shortCircuited: true });
  });
});

describe("defineAPI — afterHandler", () => {
  beforeEach(() => clearAPIRegistry());

  it("runs afterHandler after the main handler", async () => {
    const order: string[] = [];
    const api = defineAPI({
      afterHandler: async () => {
        order.push("after");
      },
      async handler() {
        order.push("handler");
        return { ok: true };
      },
    });
    await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
    expect(order).toEqual(["handler", "after"]);
  });

  it("transforms output when afterHandler returns a value", async () => {
    const api = defineAPI<unknown, { count: number }>({
      afterHandler: async ({ output }) => {
        return { count: output.count + 1 };
      },
      async handler() {
        return { count: 1 };
      },
    });
    const result = await api.handler({
      input: undefined,
      ctx: makeFakeContext(),
      params: {},
    });
    expect(result).toEqual({ count: 2 });
  });
});

describe("defineAPI — onError", () => {
  beforeEach(() => clearAPIRegistry());

  it("maps thrown errors to structured responses", async () => {
    const api = defineAPI({
      onError: async (err) => ({
        code: "NOT_FOUND",
        message: err instanceof Error ? err.message : "Unknown error",
      }),
      async handler() {
        throw new Error("User not found");
      },
    });

    try {
      await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(true).toBe(false);
    } catch (err: unknown) {
      // The mapped error is attached to the thrown error.
      expect(err).toBeInstanceOf(Error);
      const mapped = (err as Record<string, unknown>)["__capstanMapped"] as {
        code: string;
        message: string;
      };
      expect(mapped.code).toBe("NOT_FOUND");
      expect(mapped.message).toBe("User not found");
    }
  });
});

describe("defineAPI — transform", () => {
  beforeEach(() => clearAPIRegistry());

  it("transforms output before returning", async () => {
    const api = defineAPI<unknown, { name: string }>({
      transform: (output) => ({ name: output.name.toUpperCase() }),
      async handler() {
        return { name: "alice" };
      },
    });
    const result = await api.handler({
      input: undefined,
      ctx: makeFakeContext(),
      params: {},
    });
    expect(result).toEqual({ name: "ALICE" });
  });
});

describe("defineAPI — batch flag", () => {
  beforeEach(() => clearAPIRegistry());

  it("stores batch flag on the definition", () => {
    const api = defineAPI({
      batch: true,
      async handler() {
        return {};
      },
    });
    expect(api.batch).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// coerceQueryInput
// ---------------------------------------------------------------------------

describe("coerceQueryInput", () => {
  it("coerces numeric strings to numbers", () => {
    expect(coerceQueryInput({ count: "123" })).toEqual({ count: 123 });
  });

  it("coerces boolean strings", () => {
    expect(coerceQueryInput({ active: "true", deleted: "false" })).toEqual({
      active: true,
      deleted: false,
    });
  });

  it("coerces null string", () => {
    expect(coerceQueryInput({ value: "null" })).toEqual({ value: null });
  });

  it("leaves normal strings as-is", () => {
    expect(coerceQueryInput({ name: "alice" })).toEqual({ name: "alice" });
  });

  it("does not coerce empty string to number", () => {
    expect(coerceQueryInput({ q: "" })).toEqual({ q: "" });
  });
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe("withTimeout", () => {
  it("resolves when function completes within timeout", async () => {
    const result = await withTimeout(() => Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it("rejects with TimeoutError when function exceeds timeout", async () => {
    try {
      await withTimeout(
        () => new Promise((r) => setTimeout(r, 500)),
        50,
      );
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TimeoutError);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSunsetHeader
// ---------------------------------------------------------------------------

describe("buildSunsetHeader", () => {
  it("returns a valid HTTP-date string", () => {
    const header = buildSunsetHeader("2026-12-01");
    expect(header).toContain("2026");
    expect(header).toContain("Dec");
    // Should be an HTTP-date format like "Tue, 01 Dec 2026 00:00:00 GMT"
    expect(header).toContain("GMT");
  });
});

// ---------------------------------------------------------------------------
// checkRouteRateLimit
// ---------------------------------------------------------------------------

describe("checkRouteRateLimit", () => {
  beforeEach(() => clearRouteRateLimits());

  it("allows requests within the limit", () => {
    const result = checkRouteRateLimit("GET /test", "client1", {
      window: 60_000,
      max: 3,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("blocks requests that exceed the limit", () => {
    const config = { window: 60_000, max: 2 };
    checkRouteRateLimit("GET /test", "client1", config);
    checkRouteRateLimit("GET /test", "client1", config);
    const result = checkRouteRateLimit("GET /test", "client1", config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks different clients independently", () => {
    const config = { window: 60_000, max: 1 };
    checkRouteRateLimit("GET /test", "client1", config);
    const result = checkRouteRateLimit("GET /test", "client2", config);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// composePolicy
// ---------------------------------------------------------------------------

describe("composePolicy", () => {
  const ctx = makeFakeContext();

  it("runs all sub-policies and returns the most restrictive result", async () => {
    const allow = makePolicy("p1", "allow");
    const deny = makePolicy("p2", "deny", { reason: "blocked" });
    const composed = composePolicy(allow, deny);

    const result = await composed.check({ ctx });
    expect(result.effect).toBe("deny");
    expect(result.reason).toBe("blocked");
  });

  it("uses composed key format", () => {
    const p1 = makePolicy("a", "allow");
    const p2 = makePolicy("b", "deny");
    const composed = composePolicy(p1, p2);
    expect(composed.key).toBe("composed:a+b");
  });

  it("respects when guards on sub-policies", async () => {
    const deny = makePolicy("guarded", "deny", {
      reason: "should not run",
      when: () => false,
    });
    const allow = makePolicy("open", "allow");
    const composed = composePolicy(deny, allow);

    const result = await composed.check({ ctx });
    expect(result.effect).toBe("allow");
  });

  it("throws when called with no policies", () => {
    expect(() => composePolicy()).toThrow("at least one policy");
  });

  it("uses max priority from sub-policies", () => {
    const p1 = makePolicy("a", "allow", { priority: 10 });
    const p2 = makePolicy("b", "deny", { priority: 50 });
    const composed = composePolicy(p1, p2);
    expect(composed.priority).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Policy priority ordering
// ---------------------------------------------------------------------------

describe("enforcePolicies — priority ordering", () => {
  const ctx = makeFakeContext();

  beforeEach(() => clearPolicyAuditLog());

  it("evaluates higher-priority policies first", async () => {
    const order: string[] = [];
    const low = definePolicy({
      key: "low",
      title: "Low",
      effect: "allow",
      priority: 1,
      async check() {
        order.push("low");
        return { effect: "allow" };
      },
    });
    const high = definePolicy({
      key: "high",
      title: "High",
      effect: "allow",
      priority: 100,
      async check() {
        order.push("high");
        return { effect: "allow" };
      },
    });

    await enforcePolicies([low, high], ctx);
    expect(order).toEqual(["high", "low"]);
  });
});

// ---------------------------------------------------------------------------
// Conditional policies (when)
// ---------------------------------------------------------------------------

describe("enforcePolicies — conditional (when)", () => {
  const ctx = makeFakeContext();

  beforeEach(() => clearPolicyAuditLog());

  it("skips policy when `when` returns false", async () => {
    const deny = makePolicy("guarded-deny", "deny", {
      reason: "should not apply",
      when: () => false,
    });
    const result = await enforcePolicies([deny], ctx);
    expect(result.effect).toBe("allow");
  });

  it("applies policy when `when` returns true", async () => {
    const deny = makePolicy("active-deny", "deny", {
      reason: "denied",
      when: () => true,
    });
    const result = await enforcePolicies([deny], ctx);
    expect(result.effect).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// Policy groups
// ---------------------------------------------------------------------------

describe("definePolicyGroup / applyPolicyGroup", () => {
  it("bundles policies under a name", () => {
    const p1 = makePolicy("a", "allow");
    const p2 = makePolicy("b", "deny");
    const group = definePolicyGroup("admin", [p1, p2]);
    expect(group.name).toBe("admin");
    expect(group.policies).toHaveLength(2);
  });

  it("flattens back to an array of PolicyDefinition", () => {
    const p1 = makePolicy("a", "allow");
    const group = definePolicyGroup("group", [p1]);
    const flat = applyPolicyGroup(group);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.key).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Policy audit trail
// ---------------------------------------------------------------------------

describe("policy audit trail", () => {
  const ctx = makeFakeContext();

  beforeEach(() => clearPolicyAuditLog());

  it("records decisions when enforcePolicies is called", async () => {
    const deny = makePolicy("audit-deny", "deny", { reason: "no access" });
    await enforcePolicies([deny], ctx);

    const log = getPolicyAuditLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0]!.policyKey).toBe("audit-deny");
    expect(log[0]!.effect).toBe("deny");
    expect(log[0]!.reason).toBe("no access");
    expect(log[0]!.timestamp).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// denyWithCode / allowResult helpers
// ---------------------------------------------------------------------------

describe("denyWithCode", () => {
  it("returns a deny result with structured code", () => {
    const result = denyWithCode("FORBIDDEN", "Admin role required");
    expect(result.effect).toBe("deny");
    expect(result.code).toBe("FORBIDDEN");
    expect(result.reason).toBe("Admin role required");
  });
});

describe("allowResult", () => {
  it("returns an allow result", () => {
    const result = allowResult();
    expect(result.effect).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Server — health endpoints
// ---------------------------------------------------------------------------

describe("server — health endpoints", () => {
  it("GET /health returns healthy status", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const res = await capstan.app.fetch(
      new Request("http://localhost/health"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("healthy");
    expect(body.timestamp).toBeTruthy();
  });

  it("GET /ready returns ready status", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const res = await capstan.app.fetch(
      new Request("http://localhost/ready"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Server — request ID header
// ---------------------------------------------------------------------------

describe("server — request ID", () => {
  it("adds X-Request-Id header to every response", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/test-reqid", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/test-reqid"),
    );
    expect(res.status).toBe(200);
    const reqId = res.headers.get("X-Request-Id");
    expect(reqId).toBeTruthy();
  });

  it("uses custom request ID header name", async () => {
    const capstan = await createCapstanApp({
      app: { name: "test" },
      server: { requestIdHeader: "X-Trace" },
    });

    const res = await capstan.app.fetch(
      new Request("http://localhost/health"),
    );
    const traceId = res.headers.get("X-Trace");
    expect(traceId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Server — structured error responses
// ---------------------------------------------------------------------------

describe("server — structured errors", () => {
  it("returns structured error for handler exceptions", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      async handler() {
        throw new Error("something broke");
      },
    });
    capstan.registerAPI("GET", "/err", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/err"),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("something broke");
  });

  it("returns structured error for policy denial with code", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      async handler() {
        return { ok: true };
      },
    });
    const policy = definePolicy({
      key: "block",
      title: "Block",
      effect: "deny",
      async check() {
        return { effect: "deny", code: "NO_ACCESS", reason: "Denied" };
      },
    });
    capstan.registerAPI("POST", "/blocked", api, [policy]);

    const res = await capstan.app.fetch(
      new Request("http://localhost/blocked", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NO_ACCESS");
    expect(body.error.message).toBe("Denied");
  });
});

// ---------------------------------------------------------------------------
// Server — graceful shutdown
// ---------------------------------------------------------------------------

describe("server — graceful shutdown", () => {
  it("shutdown sets server to shutting_down state", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });

    // Before shutdown, health is healthy.
    let res = await capstan.app.fetch(
      new Request("http://localhost/health"),
    );
    let body = (await res.json()) as { status: string };
    expect(body.status).toBe("healthy");

    // Trigger shutdown.
    await capstan.shutdown();

    // After shutdown, health reports shutting_down.
    res = await capstan.app.fetch(
      new Request("http://localhost/health"),
    );
    body = (await res.json()) as { status: string };
    expect(body.status).toBe("shutting_down");
  });

  it("rejects new requests during shutdown with 503", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/api-test", api);

    await capstan.shutdown();

    const res = await capstan.app.fetch(
      new Request("http://localhost/api-test"),
    );
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Server — onReady / onShutdown callbacks
// ---------------------------------------------------------------------------

describe("server — lifecycle callbacks", () => {
  it("calls onReady during creation", async () => {
    let called = false;
    await createCapstanApp({
      app: { name: "test" },
      server: {
        onReady: () => {
          called = true;
        },
      },
    });
    expect(called).toBe(true);
  });

  it("calls onShutdown during shutdown", async () => {
    let called = false;
    const capstan = await createCapstanApp({
      app: { name: "test" },
      server: {
        onShutdown: () => {
          called = true;
        },
      },
    });
    await capstan.shutdown();
    expect(called).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Server — deprecation headers
// ---------------------------------------------------------------------------

describe("server — deprecation headers", () => {
  it("adds Sunset and Deprecation headers for deprecated routes", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      deprecated: { sunset: "2026-12-01", message: "Use /v2 instead" },
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/old", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/old"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Sunset")).toBeTruthy();
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("X-Deprecated-Message")).toBe("Use /v2 instead");
  });
});

// ---------------------------------------------------------------------------
// Server — route table endpoint
// ---------------------------------------------------------------------------

describe("server — route table", () => {
  it("GET /capstan/routes returns registered routes", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      description: "List things",
      async handler() {
        return [];
      },
    });
    capstan.registerAPI("GET", "/things", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/capstan/routes"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; routes: unknown[] };
    expect(body.count).toBe(1);
    expect(body.routes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Server — input coercion for GET requests
// ---------------------------------------------------------------------------

describe("server — input coercion for GET", () => {
  it("coerces query string numbers for GET routes", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    let receivedInput: unknown;
    const api = defineAPI({
      async handler({ input }) {
        receivedInput = input;
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/coerce", api);

    await capstan.app.fetch(
      new Request("http://localhost/coerce?count=42&active=true"),
    );
    expect((receivedInput as Record<string, unknown>).count).toBe(42);
    expect((receivedInput as Record<string, unknown>).active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Server — per-route rate limiting
// ---------------------------------------------------------------------------

describe("server — per-route rate limiting", () => {
  beforeEach(() => clearRouteRateLimits());

  it("returns 429 when per-route rate limit is exceeded", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      rateLimit: { window: 60_000, max: 1 },
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/limited", api);

    // First request should succeed.
    const res1 = await capstan.app.fetch(
      new Request("http://localhost/limited"),
    );
    expect(res1.status).toBe(200);

    // Second request should be rate limited.
    const res2 = await capstan.app.fetch(
      new Request("http://localhost/limited"),
    );
    expect(res2.status).toBe(429);
    const body = (await res2.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
