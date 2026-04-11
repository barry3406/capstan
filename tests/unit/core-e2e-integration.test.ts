import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import {
  createCapstanApp,
  defineAPI,
  defineMiddleware,
  definePolicy,
  definePlugin,
  enforcePolicies,
  clearRouteRateLimits,
  clearApprovals,
  resolveApproval,
  listApprovals,
  getApproval,
} from "@zauso-ai/capstan-core";
import type {
  CapstanContext,
  CapstanConfig,
  PolicyDefinition,
} from "@zauso-ai/capstan-core";

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
  effect: "allow" | "deny" | "approve" | "redact",
  reason?: string,
): PolicyDefinition {
  return definePolicy({
    key: `test-${effect}-${Math.random().toString(36).slice(2, 6)}`,
    title: `Test ${effect}`,
    effect,
    async check() {
      const result: { effect: typeof effect; reason?: string } = { effect };
      if (reason !== undefined) result.reason = reason;
      return result;
    },
  });
}

async function createTestApp(configOverrides?: Partial<CapstanConfig>) {
  const config: CapstanConfig = { app: { name: "test-app" }, ...configOverrides };
  return createCapstanApp(config);
}

async function fetchJson(app: { fetch: (req: Request) => Promise<Response> }, path: string, init?: RequestInit) {
  const url = `http://localhost${path}`;
  const response = await app.fetch(new Request(url, init));
  const body = await response.json();
  return { response, body };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearRouteRateLimits();
  clearApprovals();
});

// ===========================================================================
// Full request lifecycle
// ===========================================================================

describe("Full request lifecycle", () => {
  it("GET request -> defineAPI handler -> JSON response (200)", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      description: "Get items",
      capability: "read",
      async handler() {
        return { items: [1, 2, 3] };
      },
    });
    capstan.registerAPI("GET", "/items", api);

    const { response, body } = await fetchJson(capstan.app, "/items");
    expect(response.status).toBe(200);
    expect((body as any).items).toEqual([1, 2, 3]);
  });

  it("POST request -> Zod validation -> handler -> response", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      input: z.object({ name: z.string(), age: z.number() }),
      async handler({ input }) {
        return { greeting: `Hello ${(input as any).name}` };
      },
    });
    capstan.registerAPI("POST", "/greet", api);

    const { response, body } = await fetchJson(capstan.app, "/greet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", age: 30 }),
    });
    expect(response.status).toBe(200);
    expect((body as any).greeting).toBe("Hello Alice");
  });

  it("POST with invalid body -> 400 structured error", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      input: z.object({ name: z.string() }),
      async handler({ input }) {
        return { name: (input as any).name };
      },
    });
    capstan.registerAPI("POST", "/validate", api);

    const { response, body } = await fetchJson(capstan.app, "/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    });
    expect(response.status).toBe(400);
    expect((body as any).error.code).toBe("VALIDATION_ERROR");
  });

  it("GET with policy -> allow -> 200", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      description: "Protected read",
      async handler() {
        return { data: "secret" };
      },
    });
    const allowPolicy = makePolicy("allow");
    capstan.registerAPI("GET", "/protected", api, [allowPolicy]);

    const { response, body } = await fetchJson(capstan.app, "/protected");
    expect(response.status).toBe(200);
    expect((body as any).data).toBe("secret");
  });

  it("GET with policy -> deny -> 403", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler() {
        return { data: "secret" };
      },
    });
    const denyPolicy = makePolicy("deny", "Access denied");
    capstan.registerAPI("GET", "/denied", api, [denyPolicy]);

    const { response, body } = await fetchJson(capstan.app, "/denied");
    expect(response.status).toBe(403);
    expect((body as any).error.message).toContain("denied");
  });

  it("POST with approval policy -> 202 with pollUrl", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler() {
        return { done: true };
      },
    });
    const approvePolicy = makePolicy("approve", "Needs review");
    capstan.registerAPI("POST", "/action", api, [approvePolicy]);

    const { response, body } = await fetchJson(capstan.app, "/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(202);
    expect((body as any).status).toBe("approval_required");
    expect((body as any).pollUrl).toContain("/capstan/approvals/");
    expect((body as any).approvalId).toBeDefined();
  });

  it("approval workflow: create -> approve -> verify via store", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler() {
        return { done: true };
      },
    });
    const approvePolicy = makePolicy("approve", "Needs review");
    capstan.registerAPI("POST", "/workflow", api, [approvePolicy]);

    // Step 1: Create approval via HTTP
    const { body: createBody } = await fetchJson(capstan.app, "/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const approvalId = (createBody as any).approvalId;
    expect(approvalId).toBeDefined();

    // Step 2: Verify it is pending
    const pending = await getApproval(approvalId);
    expect(pending).toBeDefined();
    expect(pending!.status).toBe("pending");

    // Step 3: Approve it
    await resolveApproval(approvalId, "approved", "admin");

    // Step 4: Verify it is approved
    const approved = await getApproval(approvalId);
    expect(approved).toBeDefined();
    expect(approved!.status).toBe("approved");
    expect(approved!.resolvedBy).toBe("admin");
  });
});

// ===========================================================================
// Multi-protocol integration
// ===========================================================================

describe("Multi-protocol integration", () => {
  it("same defineAPI serves HTTP endpoint", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      description: "Health check",
      capability: "read",
      resource: "health",
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/health-check", api);

    const { response, body } = await fetchJson(capstan.app, "/health-check");
    expect(response.status).toBe(200);
    expect((body as any).ok).toBe(true);
  });

  it("same defineAPI appears in /.well-known/capstan.json manifest", async () => {
    const capstan = await createTestApp({
      app: { name: "manifest-test", title: "Manifest Test" },
    });
    const api = defineAPI({
      description: "List widgets",
      capability: "read",
      resource: "widget",
      async handler() {
        return { widgets: [] };
      },
    });
    capstan.registerAPI("GET", "/widgets", api);

    const { body } = await fetchJson(capstan.app, "/.well-known/capstan.json");
    expect((body as any).name).toBe("manifest-test");
    const routes = (body as any).routes as Array<{ method: string; path: string; description?: string }>;
    const widgetRoute = routes.find((r) => r.path === "/widgets");
    expect(widgetRoute).toBeDefined();
    expect(widgetRoute!.description).toBe("List widgets");
  });

  it("schema consistency: inputSchema recorded in route registry", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      input: z.object({ id: z.string() }),
      description: "Get by ID",
      capability: "read",
      async handler({ input }) {
        return { id: (input as any).id };
      },
    });
    capstan.registerAPI("GET", "/byid", api);

    const meta = capstan.routeRegistry.find((r) => r.path === "/byid");
    expect(meta).toBeDefined();
    expect(meta!.inputSchema).toBeDefined();
  });

  it("route registry captures capability and resource metadata", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      description: "Update item",
      capability: "write",
      resource: "item",
      async handler() {
        return { updated: true };
      },
    });
    capstan.registerAPI("PUT", "/items/:id", api);

    const meta = capstan.routeRegistry.find((r) => r.path === "/items/:id");
    expect(meta).toBeDefined();
    expect(meta!.capability).toBe("write");
    expect(meta!.resource).toBe("item");
  });
});

// ===========================================================================
// Auth integration
// ===========================================================================

describe("Auth integration", () => {
  it("unauthenticated request -> auth context has type anonymous", async () => {
    const capstan = await createTestApp();
    let capturedAuth: any;
    const api = defineAPI({
      async handler({ ctx }) {
        capturedAuth = ctx.auth;
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/auth-test", api);
    await capstan.app.fetch(new Request("http://localhost/auth-test"));
    expect(capturedAuth.type).toBe("anonymous");
    expect(capturedAuth.isAuthenticated).toBe(false);
  });

  it("policy can inspect auth context for deny", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler() {
        return { secret: true };
      },
    });
    const authPolicy = definePolicy({
      key: "require-auth",
      title: "Require Auth",
      effect: "deny",
      async check({ ctx }) {
        if (!ctx.auth.isAuthenticated) {
          return { effect: "deny", reason: "Not authenticated" };
        }
        return { effect: "allow" };
      },
    });
    capstan.registerAPI("GET", "/secret", api, [authPolicy]);

    const { response } = await fetchJson(capstan.app, "/secret");
    expect(response.status).toBe(403);
  });

  it("rate limit applies and returns 429 with headers", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      rateLimit: { window: 60_000, max: 2 },
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/limited", api);

    // First two requests should succeed
    const r1 = await capstan.app.fetch(new Request("http://localhost/limited"));
    expect(r1.status).toBe(200);
    const r2 = await capstan.app.fetch(new Request("http://localhost/limited"));
    expect(r2.status).toBe(200);

    // Third should be rate limited
    const r3 = await capstan.app.fetch(new Request("http://localhost/limited"));
    expect(r3.status).toBe(429);
    expect(r3.headers.get("Retry-After")).toBeDefined();
    expect(r3.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});

// ===========================================================================
// Middleware chain
// ===========================================================================

describe("Middleware chain", () => {
  it("defineMiddleware accepts object definition with name", () => {
    const mw = defineMiddleware({
      name: "test-mw",
      handler: async ({ next }) => next(),
    });
    expect(mw.name).toBe("test-mw");
    expect(typeof mw.handler).toBe("function");
  });

  it("defineMiddleware accepts bare handler function", () => {
    const mw = defineMiddleware(async ({ next }) => next());
    expect(mw.name).toBeUndefined();
    expect(typeof mw.handler).toBe("function");
  });

  it("middleware handler can produce a response", async () => {
    const mw = defineMiddleware({
      name: "short-circuit",
      handler: async () => {
        return new Response(JSON.stringify({ intercepted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const result = await mw.handler({
      request: new Request("http://localhost/test"),
      ctx: makeFakeContext(),
      next: async () => new Response("original"),
    });
    const body = await result.json();
    expect((body as any).intercepted).toBe(true);
  });

  it("multiple middlewares compose — both can modify headers", async () => {
    const mw1 = defineMiddleware({
      name: "header-adder-1",
      handler: async ({ next }) => {
        const res = await next();
        res.headers.set("X-MW-1", "present");
        return res;
      },
    });
    const mw2 = defineMiddleware({
      name: "header-adder-2",
      handler: async ({ next }) => {
        const res = await next();
        res.headers.set("X-MW-2", "present");
        return res;
      },
    });

    // Chain them manually
    const innerResponse = new Response("ok");
    const res2 = await mw2.handler({
      request: new Request("http://localhost/test"),
      ctx: makeFakeContext(),
      next: async () => {
        return await mw1.handler({
          request: new Request("http://localhost/test"),
          ctx: makeFakeContext(),
          next: async () => innerResponse,
        });
      },
    });
    expect(res2.headers.get("X-MW-1")).toBe("present");
    expect(res2.headers.get("X-MW-2")).toBe("present");
  });
});

// ===========================================================================
// Plugin integration
// ===========================================================================

describe("Plugin integration", () => {
  it("definePlugin registers routes", async () => {
    const plugin = definePlugin({
      name: "health-plugin",
      version: "1.0.0",
      setup(ctx) {
        ctx.addRoute("GET", "/plugin-health", {
          description: "Plugin health",
          handler: async () => ({ plugin: true }),
        });
      },
    });

    const capstan = await createTestApp({ plugins: [plugin] });
    // Plugin routes should appear in registry
    const pluginRoute = capstan.routeRegistry.find(
      (r) => r.path === "/plugin-health",
    );
    expect(pluginRoute).toBeDefined();
  });

  it("plugin routes appear in manifest", async () => {
    const plugin = definePlugin({
      name: "manifest-plugin",
      setup(ctx) {
        ctx.addRoute("GET", "/plugin-info", {
          description: "Plugin info",
        });
      },
    });

    const capstan = await createTestApp({ plugins: [plugin] });
    const { body } = await fetchJson(capstan.app, "/.well-known/capstan.json");
    const routes = (body as any).routes as Array<{ path: string }>;
    const found = routes.find((r) => r.path === "/plugin-info");
    expect(found).toBeDefined();
  });

  it("definePlugin returns the same object", () => {
    const plugin = definePlugin({
      name: "test-plugin",
      setup() {},
    });
    expect(plugin.name).toBe("test-plugin");
  });
});

// ===========================================================================
// Error scenarios end-to-end
// ===========================================================================

describe("Error scenarios end-to-end", () => {
  it("handler throws -> 500 structured error", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler() {
        throw new Error("Something exploded");
      },
    });
    capstan.registerAPI("GET", "/boom", api);

    const { response, body } = await fetchJson(capstan.app, "/boom");
    expect(response.status).toBe(500);
    expect((body as any).error.code).toBe("INTERNAL_ERROR");
    expect((body as any).error.message).toContain("Something exploded");
  });

  it("rate limit exceeded -> 429 with appropriate headers", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      rateLimit: { window: 60_000, max: 1 },
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/once", api);

    await capstan.app.fetch(new Request("http://localhost/once"));
    const r2 = await capstan.app.fetch(new Request("http://localhost/once"));
    expect(r2.status).toBe(429);
    const body = (await r2.json()) as any;
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(r2.headers.get("X-RateLimit-Limit")).toBe("1");
  });

  it("malformed JSON body -> request treated as empty input", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler({ input }) {
        return { received: input };
      },
    });
    capstan.registerAPI("POST", "/bad-json", api);

    const response = await capstan.app.fetch(
      new Request("http://localhost/bad-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "NOT VALID JSON {{{",
      }),
    );
    // The server should handle gracefully — either 400 or fallback to empty input
    expect([200, 400]).toContain(response.status);
  });

  it("unknown route -> 404", async () => {
    const capstan = await createTestApp();
    const response = await capstan.app.fetch(
      new Request("http://localhost/nonexistent"),
    );
    expect(response.status).toBe(404);
  });

  it("body too large -> 413 structured error", async () => {
    const capstan = await createCapstanApp({
      app: { name: "test" },
      server: { maxBodySize: 10 },
    });
    const api = defineAPI({
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("POST", "/small", api);

    const largeBody = JSON.stringify({ data: "x".repeat(100) });
    const response = await capstan.app.fetch(
      new Request("http://localhost/small", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(largeBody.length),
        },
        body: largeBody,
      }),
    );
    expect(response.status).toBe(413);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

// ===========================================================================
// Concurrent request handling
// ===========================================================================

describe("Concurrent request handling", () => {
  it("20 concurrent GET requests all succeed", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/concurrent", api);

    const promises = Array.from({ length: 20 }, () =>
      capstan.app.fetch(new Request("http://localhost/concurrent")),
    );
    const responses = await Promise.all(promises);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it("20 concurrent POST requests with rate limit -> some succeed, some 429", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      rateLimit: { window: 60_000, max: 5 },
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("POST", "/rate-test", api);

    const promises = Array.from({ length: 20 }, () =>
      capstan.app.fetch(
        new Request("http://localhost/rate-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      ),
    );
    const responses = await Promise.all(promises);
    const statuses = responses.map((r) => r.status);
    const successes = statuses.filter((s) => s === 200);
    const rateLimited = statuses.filter((s) => s === 429);
    expect(successes.length).toBeLessThanOrEqual(5);
    expect(rateLimited.length).toBeGreaterThan(0);
  });

  it("concurrent approval creates -> no duplicates", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler() {
        return { done: true };
      },
    });
    const approvePolicy = makePolicy("approve", "Review needed");
    capstan.registerAPI("POST", "/approve-concurrent", api, [approvePolicy]);

    const promises = Array.from({ length: 5 }, () =>
      capstan.app.fetch(
        new Request("http://localhost/approve-concurrent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      ),
    );
    const responses = await Promise.all(promises);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const ids = new Set(bodies.map((b: any) => b.approvalId));
    // Each concurrent request should produce a unique approval ID
    expect(ids.size).toBe(5);
  });
});

// ===========================================================================
// Health and built-in endpoints
// ===========================================================================

describe("Built-in endpoints", () => {
  it("GET /health returns healthy status", async () => {
    const capstan = await createTestApp();
    const { response, body } = await fetchJson(capstan.app, "/health");
    expect(response.status).toBe(200);
    expect((body as any).status).toBe("healthy");
  });

  it("GET /ready returns ready status", async () => {
    const capstan = await createTestApp();
    const { response, body } = await fetchJson(capstan.app, "/ready");
    expect(response.status).toBe(200);
    expect((body as any).status).toBe("ready");
  });

  it("GET /metrics returns text response", async () => {
    const capstan = await createTestApp();
    const response = await capstan.app.fetch(
      new Request("http://localhost/metrics"),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(typeof text).toBe("string");
  });

  it("GET /capstan/routes returns route table", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      description: "Test route",
      async handler() {
        return {};
      },
    });
    capstan.registerAPI("GET", "/test-rt", api);

    const { body } = await fetchJson(capstan.app, "/capstan/routes");
    expect((body as any).count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray((body as any).routes)).toBe(true);
  });
});

// ===========================================================================
// Policy enforcement (unit-level)
// ===========================================================================

describe("enforcePolicies advanced", () => {
  it("empty policies array returns allow", async () => {
    const result = await enforcePolicies([], makeFakeContext());
    expect(result.effect).toBe("allow");
  });

  it("single deny policy returns deny with reason", async () => {
    const denyPolicy = makePolicy("deny", "Blocked");
    const result = await enforcePolicies([denyPolicy], makeFakeContext());
    expect(result.effect).toBe("deny");
    expect(result.reason).toBe("Blocked");
  });

  it("deny overrides approve", async () => {
    const approve = makePolicy("approve", "needs review");
    const deny = makePolicy("deny", "no access");
    const result = await enforcePolicies([approve, deny], makeFakeContext());
    expect(result.effect).toBe("deny");
  });

  it("approve overrides allow", async () => {
    const allow = makePolicy("allow");
    const approve = makePolicy("approve", "needs review");
    const result = await enforcePolicies([allow, approve], makeFakeContext());
    expect(result.effect).toBe("approve");
  });

  it("redact overrides allow", async () => {
    const allow = makePolicy("allow");
    const redact = makePolicy("redact", "sensitive");
    const result = await enforcePolicies([allow, redact], makeFakeContext());
    expect(result.effect).toBe("redact");
  });
});

// ===========================================================================
// Deprecation headers
// ===========================================================================

describe("Deprecation headers", () => {
  it("deprecated endpoint returns Sunset and Deprecation headers", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      deprecated: { sunset: "2025-12-31", message: "Use /v2/items instead" },
      async handler() {
        return { items: [] };
      },
    });
    capstan.registerAPI("GET", "/old-items", api);

    const response = await capstan.app.fetch(
      new Request("http://localhost/old-items"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Sunset")).toBeDefined();
    expect(response.headers.get("X-Deprecated-Message")).toBe(
      "Use /v2/items instead",
    );
  });
});

// ===========================================================================
// GET query coercion
// ===========================================================================

describe("GET query coercion", () => {
  it("auto-coerces query string numbers and booleans", async () => {
    const capstan = await createTestApp();
    let capturedInput: any;
    const api = defineAPI({
      async handler({ input }) {
        capturedInput = input;
        return { received: input };
      },
    });
    capstan.registerAPI("GET", "/coerce", api);

    await capstan.app.fetch(
      new Request("http://localhost/coerce?count=42&active=true&name=alice"),
    );
    expect(capturedInput.count).toBe(42);
    expect(capturedInput.active).toBe(true);
    expect(capturedInput.name).toBe("alice");
  });
});

// ===========================================================================
// Route parameter handling
// ===========================================================================

describe("Route parameter handling", () => {
  it("params are passed to handler from URL path", async () => {
    const capstan = await createTestApp();
    let capturedParams: any;
    const api = defineAPI({
      async handler({ params }) {
        capturedParams = params;
        return { id: params.id };
      },
    });
    capstan.registerAPI("GET", "/items/:id", api);

    const { body } = await fetchJson(capstan.app, "/items/abc123");
    expect((body as any).id).toBe("abc123");
    expect(capturedParams.id).toBe("abc123");
  });
});
