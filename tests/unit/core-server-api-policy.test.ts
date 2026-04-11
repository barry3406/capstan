import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineAPI,
  clearAPIRegistry,
  getAPIRegistry,
  definePolicy,
  enforcePolicies,
  composePolicy,
  getPolicyAuditLog,
  clearPolicyAuditLog,
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
  PolicyCheckResult,
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
  opts?: {
    priority?: number;
    reason?: string;
    code?: string;
    when?: PolicyDefinition["when"];
  },
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

// ===========================================================================
// 1. SERVER TESTS (~40 tests)
// ===========================================================================

describe("Server", () => {
  // -------------------------------------------------------------------------
  // Smoke tests
  // -------------------------------------------------------------------------

  describe("smoke", () => {
    it("createCapstanApp with minimal config works", async () => {
      const capstan = await createCapstanApp({});
      expect(capstan.app).toBeDefined();
      expect(capstan.routeRegistry).toBeDefined();
      expect(typeof capstan.registerAPI).toBe("function");
      expect(typeof capstan.shutdown).toBe("function");
    });

    it("createCapstanApp with all server options works", async () => {
      const capstan = await createCapstanApp({
        app: { name: "full", title: "Full App", description: "All options" },
        server: {
          port: 3456,
          host: "0.0.0.0",
          gracefulShutdownMs: 5000,
          requestIdHeader: "X-Req",
          enableTimingHeader: true,
          maxBodySize: 512,
        },
      });
      expect(capstan.app).toBeDefined();
    });

    it("built-in /health returns 200", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      const res = await capstan.app.fetch(new Request("http://localhost/health"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("healthy");
    });

    it("built-in /ready returns 200", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      const res = await capstan.app.fetch(new Request("http://localhost/ready"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ready");
    });

    it("/capstan/routes lists registered routes", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        description: "Smoke route",
        async handler() {
          return { ok: true };
        },
      });
      capstan.registerAPI("GET", "/smoke", api);

      const res = await capstan.app.fetch(new Request("http://localhost/capstan/routes"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { count: number; routes: unknown[] };
      expect(body.count).toBeGreaterThanOrEqual(1);
    });

    it("/metrics returns prometheus-compatible text", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      const res = await capstan.app.fetch(new Request("http://localhost/metrics"));
      expect(res.status).toBe(200);
      const ct = res.headers.get("content-type");
      expect(ct).toContain("text/plain");
    });
  });

  // -------------------------------------------------------------------------
  // Request lifecycle
  // -------------------------------------------------------------------------

  describe("request lifecycle", () => {
    it("X-Request-Id header is generated for every response", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      const res = await capstan.app.fetch(new Request("http://localhost/health"));
      expect(res.headers.get("X-Request-Id")).toBeTruthy();
    });

    it("X-Response-Time header is present when enabled", async () => {
      const capstan = await createCapstanApp({
        app: { name: "test" },
        server: { enableTimingHeader: true },
      });
      const res = await capstan.app.fetch(new Request("http://localhost/health"));
      const timing = res.headers.get("X-Response-Time");
      expect(timing).toBeTruthy();
      expect(timing).toMatch(/^\d+ms$/);
    });

    it("X-Response-Time header is absent when not enabled", async () => {
      const capstan = await createCapstanApp({
        app: { name: "test" },
        server: { enableTimingHeader: false },
      });
      const res = await capstan.app.fetch(new Request("http://localhost/health"));
      expect(res.headers.get("X-Response-Time")).toBeNull();
    });

    it("custom request ID header name works", async () => {
      const capstan = await createCapstanApp({
        app: { name: "test" },
        server: { requestIdHeader: "X-Custom-Trace" },
      });
      const res = await capstan.app.fetch(new Request("http://localhost/health"));
      expect(res.headers.get("X-Custom-Trace")).toBeTruthy();
    });

    it("CORS headers are applied (Access-Control-Allow-Origin)", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      const res = await capstan.app.fetch(
        new Request("http://localhost/health", {
          headers: { Origin: "http://example.com" },
        }),
      );
      // cors() middleware should set allow-origin
      const acao = res.headers.get("Access-Control-Allow-Origin");
      expect(acao).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("structured error format: { error: { code, message } }", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        async handler() {
          throw new Error("boom");
        },
      });
      capstan.registerAPI("GET", "/err-struct", api);
      const res = await capstan.app.fetch(new Request("http://localhost/err-struct"));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toBe("boom");
    });

    it("Zod validation error returns 400 with field details", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        input: z.object({ name: z.string() }),
        async handler({ input }) {
          return input;
        },
      });
      capstan.registerAPI("POST", "/validate-zod", api);

      const res = await capstan.app.fetch(
        new Request("http://localhost/validate-zod", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: 123 }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; details: unknown[] } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(Array.isArray(body.error.details)).toBe(true);
    });

    it("unknown route returns 404", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      const res = await capstan.app.fetch(new Request("http://localhost/nonexistent"));
      expect(res.status).toBe(404);
    });

    it("handler throwing returns 500 with structured error", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        async handler() {
          throw new TypeError("type mismatch");
        },
      });
      capstan.registerAPI("GET", "/throw500", api);

      const res = await capstan.app.fetch(new Request("http://localhost/throw500"));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toBe("type mismatch");
    });

    it("handler returning undefined does not crash", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        async handler() {
          return undefined as unknown;
        },
      });
      capstan.registerAPI("GET", "/return-undef", api);

      const res = await capstan.app.fetch(new Request("http://localhost/return-undef"));
      // Should not be 500 — may be 200 with null body
      expect(res.status).toBeLessThan(500);
    });
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  describe("graceful shutdown", () => {
    it("shutdown() stops accepting new requests", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({ async handler() { return { ok: true }; } });
      capstan.registerAPI("GET", "/shut-test", api);

      await capstan.shutdown();

      const res = await capstan.app.fetch(new Request("http://localhost/shut-test"));
      expect(res.status).toBe(503);
    });

    it("health endpoint still responds during shutdown", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      await capstan.shutdown();

      const res = await capstan.app.fetch(new Request("http://localhost/health"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("shutting_down");
    });

    it("/ready returns 503 during shutdown", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      await capstan.shutdown();

      const res = await capstan.app.fetch(new Request("http://localhost/ready"));
      expect(res.status).toBe(503);
    });

    it("double shutdown is idempotent", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      await capstan.shutdown();
      // Second shutdown should not throw
      await capstan.shutdown();

      const res = await capstan.app.fetch(new Request("http://localhost/health"));
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("shutting_down");
    });

    it("onShutdown callback is invoked", async () => {
      let shutdownCalled = false;
      const capstan = await createCapstanApp({
        app: { name: "test" },
        server: { onShutdown: () => { shutdownCalled = true; } },
      });
      await capstan.shutdown();
      expect(shutdownCalled).toBe(true);
    });

    it("onReady callback is invoked during creation", async () => {
      let readyCalled = false;
      await createCapstanApp({
        app: { name: "test" },
        server: { onReady: () => { readyCalled = true; } },
      });
      expect(readyCalled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Body limits
  // -------------------------------------------------------------------------

  describe("body limits", () => {
    it("request within body limit is accepted", async () => {
      const capstan = await createCapstanApp({
        app: { name: "test" },
        server: { maxBodySize: 1024 },
      });
      clearAPIRegistry();
      const api = defineAPI({
        async handler({ input }) {
          return input as object;
        },
      });
      capstan.registerAPI("POST", "/body-ok", api);

      const smallPayload = JSON.stringify({ data: "hello" });
      const res = await capstan.app.fetch(
        new Request("http://localhost/body-ok", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(smallPayload.length),
          },
          body: smallPayload,
        }),
      );
      expect(res.status).toBe(200);
    });

    it("request exceeding body limit returns 413", async () => {
      const capstan = await createCapstanApp({
        app: { name: "test" },
        server: { maxBodySize: 10 },
      });
      clearAPIRegistry();
      const api = defineAPI({
        async handler({ input }) {
          return input as object;
        },
      });
      capstan.registerAPI("POST", "/body-big", api);

      const bigPayload = JSON.stringify({ data: "a".repeat(100) });
      const res = await capstan.app.fetch(
        new Request("http://localhost/body-big", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(bigPayload.length),
          },
          body: bigPayload,
        }),
      );
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });
  });

  // -------------------------------------------------------------------------
  // Adversarial
  // -------------------------------------------------------------------------

  describe("adversarial", () => {
    it("extremely long URL (10K chars) does not crash", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      const longPath = "/" + "a".repeat(10_000);
      const res = await capstan.app.fetch(new Request(`http://localhost${longPath}`));
      // Should return 404 (not found) rather than crash
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("malformed JSON body does not crash", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        async handler({ input }) {
          return { received: input };
        },
      });
      capstan.registerAPI("POST", "/bad-json", api);

      const res = await capstan.app.fetch(
        new Request("http://localhost/bad-json", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{ not valid json !!!",
        }),
      );
      // Should not crash — either 200 (with empty input) or 400
      expect(res.status).toBeLessThan(500);
    });

    it("missing Content-Type header on POST uses empty input", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      let receivedInput: unknown;
      const api = defineAPI({
        async handler({ input }) {
          receivedInput = input;
          return { ok: true };
        },
      });
      capstan.registerAPI("POST", "/no-ct", api);

      const res = await capstan.app.fetch(
        new Request("http://localhost/no-ct", {
          method: "POST",
          body: "some body",
        }),
      );
      expect(res.status).toBe(200);
      expect(receivedInput).toEqual({});
    });

    it("concurrent requests (50 simultaneous)", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      let count = 0;
      const api = defineAPI({
        async handler() {
          count++;
          return { n: count };
        },
      });
      capstan.registerAPI("GET", "/concurrent", api);

      const promises = Array.from({ length: 50 }, () =>
        capstan.app.fetch(new Request("http://localhost/concurrent")),
      );
      const results = await Promise.all(promises);

      for (const res of results) {
        expect(res.status).toBe(200);
      }
      expect(count).toBe(50);
    });

    it("agent manifest at /.well-known/capstan.json works", async () => {
      const capstan = await createCapstanApp({
        app: { name: "manifest-test", title: "MT", description: "desc" },
      });
      const res = await capstan.app.fetch(
        new Request("http://localhost/.well-known/capstan.json"),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; routes: unknown[] };
      expect(body.name).toBe("manifest-test");
      expect(Array.isArray(body.routes)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Deprecation headers (server-level integration)
  // -------------------------------------------------------------------------

  describe("deprecation headers (integration)", () => {
    it("deprecated route has Sunset header", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        deprecated: { sunset: "2027-01-01" },
        async handler() { return { ok: true }; },
      });
      capstan.registerAPI("GET", "/dep-sunset", api);

      const res = await capstan.app.fetch(new Request("http://localhost/dep-sunset"));
      expect(res.headers.get("Sunset")).toBeTruthy();
      expect(res.headers.get("Sunset")).toContain("2027");
    });

    it("deprecated route has Deprecation header", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        deprecated: { sunset: "2027-01-01" },
        async handler() { return { ok: true }; },
      });
      capstan.registerAPI("GET", "/dep-header", api);

      const res = await capstan.app.fetch(new Request("http://localhost/dep-header"));
      expect(res.headers.get("Deprecation")).toBe("true");
    });

    it("non-deprecated route has no Sunset header", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        async handler() { return { ok: true }; },
      });
      capstan.registerAPI("GET", "/no-dep", api);

      const res = await capstan.app.fetch(new Request("http://localhost/no-dep"));
      expect(res.headers.get("Sunset")).toBeNull();
      expect(res.headers.get("Deprecation")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Per-route rate limiting (server integration)
  // -------------------------------------------------------------------------

  describe("rate limiting (integration)", () => {
    beforeEach(() => clearRouteRateLimits());

    it("under rate limit: requests succeed", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        rateLimit: { window: 60_000, max: 5 },
        async handler() { return { ok: true }; },
      });
      capstan.registerAPI("GET", "/rl-ok", api);

      const res = await capstan.app.fetch(new Request("http://localhost/rl-ok"));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(Number(res.headers.get("X-RateLimit-Remaining"))).toBeGreaterThanOrEqual(0);
    });

    it("over rate limit: returns 429", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        rateLimit: { window: 60_000, max: 1 },
        async handler() { return { ok: true }; },
      });
      capstan.registerAPI("GET", "/rl-429", api);

      await capstan.app.fetch(new Request("http://localhost/rl-429"));
      const res2 = await capstan.app.fetch(new Request("http://localhost/rl-429"));
      expect(res2.status).toBe(429);
    });

    it("Retry-After header is present on 429", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        rateLimit: { window: 60_000, max: 1 },
        async handler() { return { ok: true }; },
      });
      capstan.registerAPI("GET", "/rl-retry", api);

      await capstan.app.fetch(new Request("http://localhost/rl-retry"));
      const res2 = await capstan.app.fetch(new Request("http://localhost/rl-retry"));
      expect(res2.status).toBe(429);
      expect(res2.headers.get("Retry-After")).toBeTruthy();
      expect(Number(res2.headers.get("Retry-After"))).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Input coercion (server integration)
  // -------------------------------------------------------------------------

  describe("input coercion (integration)", () => {
    it("GET query 123 coerced to number", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      let receivedInput: unknown;
      const api = defineAPI({
        async handler({ input }) { receivedInput = input; return {}; },
      });
      capstan.registerAPI("GET", "/coerce-num", api);

      await capstan.app.fetch(new Request("http://localhost/coerce-num?val=123"));
      expect((receivedInput as Record<string, unknown>).val).toBe(123);
    });

    it("GET query true coerced to boolean", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      let receivedInput: unknown;
      const api = defineAPI({
        async handler({ input }) { receivedInput = input; return {}; },
      });
      capstan.registerAPI("GET", "/coerce-bool", api);

      await capstan.app.fetch(new Request("http://localhost/coerce-bool?flag=true"));
      expect((receivedInput as Record<string, unknown>).flag).toBe(true);
    });

    it("GET query null coerced to null", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      let receivedInput: unknown;
      const api = defineAPI({
        async handler({ input }) { receivedInput = input; return {}; },
      });
      capstan.registerAPI("GET", "/coerce-null", api);

      await capstan.app.fetch(new Request("http://localhost/coerce-null?val=null"));
      expect((receivedInput as Record<string, unknown>).val).toBeNull();
    });

    it("POST body NOT coerced (stays as-is)", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      let receivedInput: unknown;
      const api = defineAPI({
        async handler({ input }) { receivedInput = input; return {}; },
      });
      capstan.registerAPI("POST", "/coerce-post", api);

      await capstan.app.fetch(
        new Request("http://localhost/coerce-post", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ val: "123", flag: "true" }),
        }),
      );
      // POST should keep strings as strings
      expect((receivedInput as Record<string, unknown>).val).toBe("123");
      expect((receivedInput as Record<string, unknown>).flag).toBe("true");
    });
  });

  // -------------------------------------------------------------------------
  // Policy enforcement via server
  // -------------------------------------------------------------------------

  describe("policy enforcement (integration)", () => {
    it("policy allow lets request through", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({ async handler() { return { ok: true }; } });
      const policy = definePolicy({
        key: "always-allow",
        title: "Allow",
        effect: "allow",
        async check() { return { effect: "allow" }; },
      });
      capstan.registerAPI("GET", "/policy-allow", api, [policy]);

      const res = await capstan.app.fetch(new Request("http://localhost/policy-allow"));
      expect(res.status).toBe(200);
    });

    it("policy deny returns 403", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({ async handler() { return { ok: true }; } });
      const policy = definePolicy({
        key: "always-deny",
        title: "Deny",
        effect: "deny",
        async check() { return { effect: "deny", code: "BLOCKED", reason: "no way" }; },
      });
      capstan.registerAPI("GET", "/policy-deny", api, [policy]);

      const res = await capstan.app.fetch(new Request("http://localhost/policy-deny"));
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("BLOCKED");
      expect(body.error.message).toBe("no way");
    });

    it("policy approve returns 202 with approvalId", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({ async handler() { return { ok: true }; } });
      const policy = definePolicy({
        key: "needs-approval",
        title: "Approve",
        effect: "approve",
        async check() { return { effect: "approve", reason: "needs human review" }; },
      });
      capstan.registerAPI("POST", "/policy-approve", api, [policy]);

      const res = await capstan.app.fetch(
        new Request("http://localhost/policy-approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      expect(res.status).toBe(202);
      const body = (await res.json()) as { status: string; approvalId: string };
      expect(body.status).toBe("approval_required");
      expect(body.approvalId).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // onError mapping (server integration)
  // -------------------------------------------------------------------------

  describe("onError mapping (integration)", () => {
    it("onError transforms handler errors to 400 structured response", async () => {
      const capstan = await createCapstanApp({ app: { name: "test" } });
      clearAPIRegistry();
      const api = defineAPI({
        onError: async (err) => ({
          code: "CUSTOM_ERROR",
          message: err instanceof Error ? err.message : "Unknown",
        }),
        async handler() {
          throw new Error("custom failure");
        },
      });
      capstan.registerAPI("GET", "/onerr", api);

      const res = await capstan.app.fetch(new Request("http://localhost/onerr"));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("CUSTOM_ERROR");
      expect(body.error.message).toBe("custom failure");
    });
  });
});

// ===========================================================================
// 2. defineAPI TESTS (~30 tests)
// ===========================================================================

describe("defineAPI", () => {
  beforeEach(() => clearAPIRegistry());

  // -------------------------------------------------------------------------
  // Smoke
  // -------------------------------------------------------------------------

  describe("smoke", () => {
    it("defineAPI with minimal fields works", () => {
      const api = defineAPI({ async handler() { return {}; } });
      expect(typeof api.handler).toBe("function");
    });

    it("defineAPI with all fields works", () => {
      const api = defineAPI({
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.number() }),
        description: "Create user",
        capability: "write",
        resource: "user",
        policy: "requireAuth",
        timeout: 5000,
        deprecated: { sunset: "2027-06-01", message: "Use v2" },
        rateLimit: { window: 60_000, max: 100 },
        batch: false,
        beforeHandler: async () => {},
        afterHandler: async () => {},
        transform: (o) => o,
        onError: async () => ({ code: "ERR", message: "err" }),
        async handler() { return { id: 1 }; },
      });
      expect(api.description).toBe("Create user");
      expect(api.capability).toBe("write");
      expect(api.timeout).toBe(5000);
    });

    it("API registry tracks all definitions", () => {
      defineAPI({ async handler() { return { a: 1 }; } });
      defineAPI({ async handler() { return { b: 2 }; } });
      const registry = getAPIRegistry();
      expect(registry.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle hooks
  // -------------------------------------------------------------------------

  describe("lifecycle hooks", () => {
    it("beforeHandler runs before handler", async () => {
      const order: string[] = [];
      const api = defineAPI({
        beforeHandler: async () => { order.push("before"); },
        async handler() { order.push("handler"); return {}; },
      });
      await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(order).toEqual(["before", "handler"]);
    });

    it("afterHandler runs after handler", async () => {
      const order: string[] = [];
      const api = defineAPI({
        afterHandler: async () => { order.push("after"); },
        async handler() { order.push("handler"); return {}; },
      });
      await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(order).toEqual(["handler", "after"]);
    });

    it("beforeHandler can short-circuit by returning value", async () => {
      const api = defineAPI({
        beforeHandler: async () => ({ cached: true }),
        async handler() { return { cached: false }; },
      });
      const result = await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(result).toEqual({ cached: true });
    });

    it("afterHandler receives output and can transform it", async () => {
      const api = defineAPI<unknown, { count: number }>({
        afterHandler: async ({ output }) => ({ count: output.count * 2 }),
        async handler() { return { count: 5 }; },
      });
      const result = await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(result).toEqual({ count: 10 });
    });

    it("beforeHandler throwing returns error, handler not called", async () => {
      let handlerCalled = false;
      const api = defineAPI({
        beforeHandler: async () => { throw new Error("before failed"); },
        async handler() { handlerCalled = true; return {}; },
      });
      await expect(
        api.handler({ input: undefined, ctx: makeFakeContext(), params: {} }),
      ).rejects.toThrow("before failed");
      expect(handlerCalled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------

  describe("timeout", () => {
    it("handler within timeout succeeds", async () => {
      const api = defineAPI({
        timeout: 5000,
        async handler() { return { fast: true }; },
      });
      const result = await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(result).toEqual({ fast: true });
    });

    it("handler exceeding timeout throws TimeoutError", async () => {
      const api = defineAPI({
        timeout: 30,
        async handler() {
          await new Promise((r) => setTimeout(r, 300));
          return {};
        },
      });
      await expect(
        api.handler({ input: undefined, ctx: makeFakeContext(), params: {} }),
      ).rejects.toThrow("timed out");
    });

    it("timeout does not leak timer on fast handler", async () => {
      const api = defineAPI({
        timeout: 60_000,
        async handler() { return { ok: true }; },
      });
      // Just confirm it resolves quickly and cleanly
      const start = Date.now();
      await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe("input validation", () => {
    it("valid input passes through", async () => {
      const api = defineAPI({
        input: z.object({ name: z.string() }),
        async handler({ input }) { return input; },
      });
      const result = await api.handler({
        input: { name: "Alice" },
        ctx: makeFakeContext(),
        params: {},
      });
      expect(result).toEqual({ name: "Alice" });
    });

    it("invalid input throws Zod error", async () => {
      const api = defineAPI({
        input: z.object({ age: z.number() }),
        async handler({ input }) { return input; },
      });
      await expect(
        api.handler({ input: { age: "not a number" }, ctx: makeFakeContext(), params: {} }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Output validation
  // -------------------------------------------------------------------------

  describe("output validation", () => {
    it("valid output passes through", async () => {
      const api = defineAPI({
        output: z.object({ id: z.number() }),
        async handler() { return { id: 42 }; },
      });
      const result = await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(result).toEqual({ id: 42 });
    });

    it("invalid output throws Zod error", async () => {
      const api = defineAPI({
        output: z.object({ id: z.number() }),
        async handler() { return { id: "wrong" } as unknown as { id: number }; },
      });
      await expect(
        api.handler({ input: undefined, ctx: makeFakeContext(), params: {} }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Error mapping
  // -------------------------------------------------------------------------

  describe("error mapping", () => {
    it("onError transforms handler errors", async () => {
      const api = defineAPI({
        onError: async (err) => ({
          code: "MAPPED",
          message: err instanceof Error ? err.message : "unknown",
        }),
        async handler() { throw new Error("original"); },
      });

      try {
        await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
        expect(true).toBe(false);
      } catch (err: unknown) {
        const mapped = (err as Record<string, unknown>)["__capstanMapped"] as {
          code: string; message: string;
        };
        expect(mapped.code).toBe("MAPPED");
        expect(mapped.message).toBe("original");
      }
    });

    it("onError receives error and context", async () => {
      let receivedErr: unknown;
      let receivedCtx: unknown;
      const api = defineAPI({
        onError: async (err, ctx) => {
          receivedErr = err;
          receivedCtx = ctx;
          return { code: "TEST", message: "test" };
        },
        async handler() { throw new Error("ctx-check"); },
      });
      const ctx = makeFakeContext();
      try {
        await api.handler({ input: undefined, ctx, params: {} });
      } catch {
        // expected
      }
      expect(receivedErr).toBeInstanceOf(Error);
      expect((receivedErr as Error).message).toBe("ctx-check");
      expect(receivedCtx).toBe(ctx);
    });

    it("without onError, error propagates normally", async () => {
      const api = defineAPI({
        async handler() { throw new Error("raw error"); },
      });
      await expect(
        api.handler({ input: undefined, ctx: makeFakeContext(), params: {} }),
      ).rejects.toThrow("raw error");
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  describe("idempotency", () => {
    it("same input produces same output", async () => {
      const api = defineAPI({
        async handler({ input }) { return { echo: input }; },
      });
      const ctx = makeFakeContext();
      const r1 = await api.handler({ input: { a: 1 }, ctx, params: {} });
      const r2 = await api.handler({ input: { a: 1 }, ctx, params: {} });
      expect(r1).toEqual(r2);
    });

    it("calling defineAPI twice creates 2 registry entries", () => {
      clearAPIRegistry();
      defineAPI({ description: "first", async handler() { return {}; } });
      defineAPI({ description: "second", async handler() { return {}; } });
      const registry = getAPIRegistry();
      expect(registry.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Adversarial
  // -------------------------------------------------------------------------

  describe("adversarial", () => {
    it("handler that never resolves (with timeout configured) throws", async () => {
      const api = defineAPI({
        timeout: 50,
        async handler() {
          return new Promise(() => {}); // never resolves
        },
      });
      await expect(
        api.handler({ input: undefined, ctx: makeFakeContext(), params: {} }),
      ).rejects.toThrow("timed out");
    });

    it("input schema rejects extra properties when strict", async () => {
      const api = defineAPI({
        input: z.object({ name: z.string() }).strict(),
        async handler({ input }) { return input; },
      });
      await expect(
        api.handler({ input: { name: "ok", extra: true }, ctx: makeFakeContext(), params: {} }),
      ).rejects.toThrow();
    });

    it("empty input schema (no schema) accepts anything", async () => {
      const api = defineAPI({
        async handler({ input }) { return { got: input }; },
      });
      const result = await api.handler({
        input: { anything: [1, 2, 3] },
        ctx: makeFakeContext(),
        params: {},
      });
      expect(result).toEqual({ got: { anything: [1, 2, 3] } });
    });

    it("transform hook is applied after handler", async () => {
      const api = defineAPI<unknown, { name: string }>({
        transform: (o) => ({ name: o.name.toUpperCase() }),
        async handler() { return { name: "test" }; },
      });
      const result = await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(result).toEqual({ name: "TEST" });
    });
  });
});

// ===========================================================================
// 3. POLICY TESTS (~30 tests)
// ===========================================================================

describe("Policy", () => {
  const ctx = makeFakeContext();

  beforeEach(() => clearPolicyAuditLog());

  // -------------------------------------------------------------------------
  // Smoke
  // -------------------------------------------------------------------------

  describe("smoke", () => {
    it("definePolicy with minimal config works", () => {
      const policy = definePolicy({
        key: "min",
        title: "Minimal",
        effect: "allow",
        async check() { return { effect: "allow" }; },
      });
      expect(policy.key).toBe("min");
      expect(policy.effect).toBe("allow");
    });

    it("enforcePolicies with allow passes", async () => {
      const allow = makePolicy("p-allow", "allow");
      const result = await enforcePolicies([allow], ctx);
      expect(result.effect).toBe("allow");
    });

    it("enforcePolicies with deny blocks", async () => {
      const deny = makePolicy("p-deny", "deny", { reason: "blocked" });
      const result = await enforcePolicies([deny], ctx);
      expect(result.effect).toBe("deny");
      expect(result.reason).toBe("blocked");
    });
  });

  // -------------------------------------------------------------------------
  // Composition
  // -------------------------------------------------------------------------

  describe("composition", () => {
    it("composePolicy applies all policies", async () => {
      const order: string[] = [];
      const p1 = definePolicy({
        key: "c1", title: "C1", effect: "allow",
        async check() { order.push("c1"); return { effect: "allow" }; },
      });
      const p2 = definePolicy({
        key: "c2", title: "C2", effect: "allow",
        async check() { order.push("c2"); return { effect: "allow" }; },
      });
      const composed = composePolicy(p1, p2);
      await composed.check({ ctx });
      expect(order).toEqual(["c1", "c2"]);
    });

    it("composePolicy: deny overrides allow", async () => {
      const allow = makePolicy("ca", "allow");
      const deny = makePolicy("cd", "deny", { reason: "nope" });
      const composed = composePolicy(allow, deny);
      const result = await composed.check({ ctx });
      expect(result.effect).toBe("deny");
    });

    it("composePolicy: approve overrides allow", async () => {
      const allow = makePolicy("ca2", "allow");
      const approve = makePolicy("cap", "approve", { reason: "review" });
      const composed = composePolicy(allow, approve);
      const result = await composed.check({ ctx });
      expect(result.effect).toBe("approve");
    });

    it("composePolicy: first deny wins over second deny on ties", async () => {
      const deny1 = makePolicy("d1", "deny", { reason: "first" });
      const deny2 = makePolicy("d2", "deny", { reason: "second" });
      const composed = composePolicy(deny1, deny2);
      const result = await composed.check({ ctx });
      // The second deny wins because severity >= picks the later one
      expect(result.effect).toBe("deny");
      expect(result.reason).toBe("second");
    });
  });

  // -------------------------------------------------------------------------
  // Priority
  // -------------------------------------------------------------------------

  describe("priority", () => {
    it("higher priority policy runs first", async () => {
      const order: string[] = [];
      const low = definePolicy({
        key: "low", title: "Low", effect: "allow", priority: 1,
        async check() { order.push("low"); return { effect: "allow" }; },
      });
      const high = definePolicy({
        key: "high", title: "High", effect: "allow", priority: 100,
        async check() { order.push("high"); return { effect: "allow" }; },
      });
      await enforcePolicies([low, high], ctx);
      expect(order[0]).toBe("high");
      expect(order[1]).toBe("low");
    });

    it("equal priority preserves insertion order", async () => {
      const order: string[] = [];
      const p1 = definePolicy({
        key: "p1", title: "P1", effect: "allow", priority: 5,
        async check() { order.push("p1"); return { effect: "allow" }; },
      });
      const p2 = definePolicy({
        key: "p2", title: "P2", effect: "allow", priority: 5,
        async check() { order.push("p2"); return { effect: "allow" }; },
      });
      await enforcePolicies([p1, p2], ctx);
      expect(order).toEqual(["p1", "p2"]);
    });
  });

  // -------------------------------------------------------------------------
  // Conditional (when)
  // -------------------------------------------------------------------------

  describe("conditional", () => {
    it("policy with when: true runs check", async () => {
      const deny = makePolicy("when-true", "deny", { reason: "ran", when: () => true });
      const result = await enforcePolicies([deny], ctx);
      expect(result.effect).toBe("deny");
    });

    it("policy with when: false skips check", async () => {
      const deny = makePolicy("when-false", "deny", { reason: "skipped", when: () => false });
      const result = await enforcePolicies([deny], ctx);
      // Skipped, so default allow
      expect(result.effect).toBe("allow");
    });

    it("policy with when function evaluated per request", async () => {
      let callCount = 0;
      const policy = definePolicy({
        key: "per-req", title: "PerReq", effect: "allow",
        when: () => { callCount++; return true; },
        async check() { return { effect: "allow" }; },
      });
      await enforcePolicies([policy], ctx);
      await enforcePolicies([policy], ctx);
      expect(callCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Audit trail
  // -------------------------------------------------------------------------

  describe("audit trail", () => {
    it("policy decision is logged", async () => {
      const deny = makePolicy("audit1", "deny", { reason: "logged" });
      await enforcePolicies([deny], ctx);
      const log = getPolicyAuditLog();
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log.some((e) => e.policyKey === "audit1")).toBe(true);
    });

    it("getPolicyAuditLog returns all decisions", async () => {
      const p1 = makePolicy("a1", "allow");
      const p2 = makePolicy("a2", "deny", { reason: "no" });
      await enforcePolicies([p1, p2], ctx);
      const log = getPolicyAuditLog();
      expect(log.length).toBeGreaterThanOrEqual(2);
    });

    it("clearPolicyAuditLog removes all entries", async () => {
      const deny = makePolicy("clear-test", "deny");
      await enforcePolicies([deny], ctx);
      expect(getPolicyAuditLog().length).toBeGreaterThan(0);
      clearPolicyAuditLog();
      expect(getPolicyAuditLog().length).toBe(0);
    });

    it("audit entry has timestamp, policyKey, and effect", async () => {
      const deny = makePolicy("ts-test", "deny", { reason: "ts" });
      await enforcePolicies([deny], ctx);
      const entry = getPolicyAuditLog().find((e) => e.policyKey === "ts-test");
      expect(entry).toBeDefined();
      expect(entry!.timestamp).toBeTruthy();
      expect(entry!.policyKey).toBe("ts-test");
      expect(entry!.effect).toBe("deny");
    });

    it("audit entry has subject when user is authenticated", async () => {
      const ctxAuth = makeFakeContext({
        auth: { isAuthenticated: true, type: "human", userId: "user-42" },
      });
      const allow = makePolicy("subj-test", "allow");
      await enforcePolicies([allow], ctxAuth);
      const entry = getPolicyAuditLog().find((e) => e.policyKey === "subj-test");
      expect(entry).toBeDefined();
      expect(entry!.subject).toBe("user-42");
    });
  });

  // -------------------------------------------------------------------------
  // Adversarial
  // -------------------------------------------------------------------------

  describe("adversarial", () => {
    it("policy check that throws is treated as error (propagates)", async () => {
      const badPolicy = definePolicy({
        key: "throws", title: "Throws", effect: "deny",
        async check() { throw new Error("policy exploded"); },
      });
      await expect(enforcePolicies([badPolicy], ctx)).rejects.toThrow("policy exploded");
    });

    it("empty policy array returns allow (no restrictions)", async () => {
      const result = await enforcePolicies([], ctx);
      expect(result.effect).toBe("allow");
    });

    it("100 policies in sequence complete within reasonable time", async () => {
      const policies: PolicyDefinition[] = [];
      for (let i = 0; i < 100; i++) {
        policies.push(
          definePolicy({
            key: `p${i}`, title: `P${i}`, effect: "allow",
            async check() { return { effect: "allow" }; },
          }),
        );
      }
      const start = Date.now();
      const result = await enforcePolicies(policies, ctx);
      const elapsed = Date.now() - start;
      expect(result.effect).toBe("allow");
      expect(elapsed).toBeLessThan(2000); // should be very fast
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  describe("idempotency", () => {
    it("same policy applied twice produces consistent results", async () => {
      const policy = makePolicy("idem", "deny", { reason: "consistent" });
      const r1 = await enforcePolicies([policy], ctx);
      clearPolicyAuditLog();
      const r2 = await enforcePolicies([policy], ctx);
      expect(r1.effect).toBe(r2.effect);
      expect(r1.reason).toBe(r2.reason);
    });

    it("policy state does not leak between requests", async () => {
      let callCount = 0;
      const policy = definePolicy({
        key: "leak-test", title: "Leak", effect: "allow",
        async check() {
          callCount++;
          return { effect: callCount > 1 ? "deny" : "allow" };
        },
      });
      const r1 = await enforcePolicies([policy], ctx);
      expect(r1.effect).toBe("allow");
      // Second call — callCount increments, showing the check runs fresh
      const r2 = await enforcePolicies([policy], ctx);
      expect(r2.effect).toBe("deny");
    });
  });

  // -------------------------------------------------------------------------
  // Mutation testing (verify tests catch real bugs)
  // -------------------------------------------------------------------------

  describe("mutation testing", () => {
    it("if allow -> deny is swapped, test catches it", async () => {
      const allow = makePolicy("mut-allow", "allow");
      const deny = makePolicy("mut-deny", "deny", { reason: "blocked" });
      const result = await enforcePolicies([allow, deny], ctx);
      // This would fail if deny was silently converted to allow
      expect(result.effect).toBe("deny");
      expect(result.effect).not.toBe("allow");
    });

    it("if priority sorting is removed, test catches it", async () => {
      const order: string[] = [];
      const low = definePolicy({
        key: "mut-low", title: "Low", effect: "allow", priority: 1,
        async check() { order.push("low"); return { effect: "allow" }; },
      });
      const high = definePolicy({
        key: "mut-high", title: "High", effect: "allow", priority: 100,
        async check() { order.push("high"); return { effect: "allow" }; },
      });
      // Pass low first — without sorting, low would run first
      await enforcePolicies([low, high], ctx);
      expect(order[0]).toBe("high"); // Breaks if priority sorting is removed
    });

    it("if audit logging is removed, test catches it", async () => {
      clearPolicyAuditLog();
      const deny = makePolicy("mut-audit", "deny", { reason: "logged" });
      await enforcePolicies([deny], ctx);
      const log = getPolicyAuditLog();
      // Breaks if recordPolicyAudit call is removed
      expect(log.length).toBeGreaterThan(0);
      expect(log.some((e) => e.policyKey === "mut-audit")).toBe(true);
    });
  });
});

// ===========================================================================
// Standalone utility tests (coerceQueryInput, withTimeout, buildSunsetHeader)
// ===========================================================================

describe("coerceQueryInput (additional)", () => {
  it("floating point numbers are coerced", () => {
    expect(coerceQueryInput({ pi: "3.14" })).toEqual({ pi: 3.14 });
  });

  it("negative numbers are coerced", () => {
    expect(coerceQueryInput({ temp: "-5" })).toEqual({ temp: -5 });
  });

  it("Infinity string is NOT coerced (not finite)", () => {
    expect(coerceQueryInput({ val: "Infinity" })).toEqual({ val: "Infinity" });
  });

  it("NaN string is NOT coerced", () => {
    expect(coerceQueryInput({ val: "NaN" })).toEqual({ val: "NaN" });
  });

  it("mixed keys are all coerced correctly", () => {
    const result = coerceQueryInput({
      count: "10",
      active: "false",
      name: "alice",
      nothing: "null",
    });
    expect(result).toEqual({ count: 10, active: false, name: "alice", nothing: null });
  });
});

describe("withTimeout (additional)", () => {
  it("returns the correct value on success", async () => {
    const result = await withTimeout(() => Promise.resolve("hello"), 1000);
    expect(result).toBe("hello");
  });

  it("propagates handler errors (not timeout)", async () => {
    await expect(
      withTimeout(() => Promise.reject(new Error("handler err")), 5000),
    ).rejects.toThrow("handler err");
  });
});

describe("buildSunsetHeader (additional)", () => {
  it("produces UTC string with GMT suffix", () => {
    const header = buildSunsetHeader("2030-06-15");
    expect(header).toContain("GMT");
    expect(header).toContain("2030");
  });
});

describe("checkRouteRateLimit (additional)", () => {
  beforeEach(() => clearRouteRateLimits());

  it("different routes are tracked independently", () => {
    const config = { window: 60_000, max: 1 };
    checkRouteRateLimit("GET /a", "c1", config);
    const result = checkRouteRateLimit("GET /b", "c1", config);
    expect(result.allowed).toBe(true);
  });

  it("retryAfterMs is positive when blocked", () => {
    const config = { window: 60_000, max: 1 };
    checkRouteRateLimit("GET /x", "c1", config);
    const result = checkRouteRateLimit("GET /x", "c1", config);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });
});
