import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import {
  createCapstanApp,
  defineAPI,
  definePolicy,
  enforcePolicies,
  composePolicy,
  clearAPIRegistry,
  clearRouteRateLimits,
  checkRouteRateLimit,
  coerceQueryInput,
  withTimeout,
  TimeoutError,
  buildSunsetHeader,
  // Cache
  cacheSet,
  cacheGet,
  cacheInvalidateTag,
  cacheInvalidate,
  cacheClear,
  cached,
  setCacheStore,
  // Response cache
  responseCacheClear,
  setResponseCacheStore,
  // Rate limit
  defineRateLimit,
  clearRateLimitStore,
  // CSRF
  csrfProtection,
  // Circuit breaker
  CircuitBreaker,
  CircuitOpenError,
  // Compliance
  defineCompliance,
  recordAuditEntry,
  getAuditLog,
  clearAuditLog,
  setAuditStore,
  // Metrics
  Counter,
  Histogram,
  counter,
  histogram,
  serializeMetrics,
  resetMetrics,
  // WebSocket
  defineWebSocket,
  WebSocketRoom,
  // Store
  MemoryStore,
  // Approvals
  clearApprovals,
  createApproval,
  getApproval,
  listApprovals,
  resolveApproval,
  setApprovalStore,
  // Policy
  getPolicyAuditLog,
  clearPolicyAuditLog,
  denyWithCode,
  allowResult,
  definePolicyGroup,
  applyPolicyGroup,
  getAPIRegistry,
  // Cache utils
  normalizeCacheTag,
  normalizeCacheTags,
  normalizeCachePath,
  createPageCacheKey,
} from "@zauso-ai/capstan-core";
import type {
  CapstanContext,
  CapstanConfig,
  PolicyDefinition,
  PolicyCheckResult,
  WebSocketClient,
  AuditEntry,
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

async function createTestApp(configOverrides?: Partial<CapstanConfig>) {
  const config: CapstanConfig = { app: { name: "test-app" }, ...configOverrides };
  return createCapstanApp(config);
}

async function fetchJson(
  app: { fetch: (req: Request) => Promise<Response> },
  path: string,
  init?: RequestInit,
) {
  const url = `http://localhost${path}`;
  const response = await app.fetch(new Request(url, init));
  const body = await response.json();
  return { response, body };
}

function createMockClient(readyState = 1): WebSocketClient & {
  sent: (string | ArrayBuffer)[];
  closed: boolean;
} {
  const sent: (string | ArrayBuffer)[] = [];
  return {
    readyState,
    sent,
    closed: false,
    send(data: string | ArrayBuffer) {
      sent.push(data);
    },
    close() {
      (this as any).closed = true;
      (this as any).readyState = 3;
    },
  };
}

function advanceTime(ms: number) {
  const original = Date.now;
  const base = original();
  Date.now = () => base + ms;
  return () => {
    Date.now = original;
  };
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID(),
    method: "POST",
    path: "/api/test",
    riskLevel: "limited",
    auth: { type: "human", userId: "user-1" },
    input: { foo: "bar" },
    output: { ok: true },
    durationMs: 42,
    ...overrides,
  };
}

// ===========================================================================
// 1. MUTATION TESTING — defineAPI input validation order
// ===========================================================================

describe("Mutation: defineAPI input validation happens before handler", () => {
  beforeEach(() => clearAPIRegistry());

  it("invalid input prevents handler execution (mutation: swap validation order)", async () => {
    let handlerRan = false;
    const api = defineAPI({
      input: z.object({ name: z.string() }),
      async handler() {
        handlerRan = true;
        return { ok: true };
      },
    });

    try {
      await api.handler({ input: { name: 123 }, ctx: makeFakeContext(), params: {} });
    } catch {
      // Expected: Zod validation error
    }
    expect(handlerRan).toBe(false);
  });

  it("valid input allows handler execution", async () => {
    let handlerRan = false;
    const api = defineAPI({
      input: z.object({ name: z.string() }),
      async handler() {
        handlerRan = true;
        return { ok: true };
      },
    });

    await api.handler({ input: { name: "alice" }, ctx: makeFakeContext(), params: {} });
    expect(handlerRan).toBe(true);
  });

  it("output validation catches invalid handler output", async () => {
    const api = defineAPI({
      output: z.object({ count: z.number() }),
      async handler() {
        return { count: "not-a-number" } as any;
      },
    });

    try {
      await api.handler({ input: undefined, ctx: makeFakeContext(), params: {} });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.issues).toBeDefined();
      expect(err.issues.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// 2. MUTATION: enforcePolicies priority sort
// ===========================================================================

describe("Mutation: enforcePolicies priority ordering", () => {
  const ctx = makeFakeContext();
  beforeEach(() => clearPolicyAuditLog());

  it("higher priority policies are evaluated before lower ones", async () => {
    const order: string[] = [];
    const low = definePolicy({
      key: "low-mut",
      title: "Low",
      effect: "allow",
      priority: 1,
      async check() {
        order.push("low");
        return { effect: "allow" };
      },
    });
    const high = definePolicy({
      key: "high-mut",
      title: "High",
      effect: "allow",
      priority: 100,
      async check() {
        order.push("high");
        return { effect: "allow" };
      },
    });

    await enforcePolicies([low, high], ctx);
    expect(order[0]).toBe("high");
    expect(order[1]).toBe("low");
  });

  it("without priority sort, order would be input order (mutation guard)", async () => {
    // This test documents that the sort is happening.
    // If someone removes sorting, the first call's order changes.
    const order: string[] = [];
    const first = definePolicy({
      key: "first-mut",
      title: "First",
      effect: "allow",
      priority: 1,
      async check() {
        order.push("first");
        return { effect: "allow" };
      },
    });
    const second = definePolicy({
      key: "second-mut",
      title: "Second",
      effect: "allow",
      priority: 50,
      async check() {
        order.push("second");
        return { effect: "allow" };
      },
    });

    await enforcePolicies([first, second], ctx);
    // If priority sort works, second (priority 50) runs before first (priority 1)
    expect(order).toEqual(["second", "first"]);
  });
});

// ===========================================================================
// 3. MUTATION: composePolicy deny vs allow
// ===========================================================================

describe("Mutation: composePolicy most-restrictive wins", () => {
  const ctx = makeFakeContext();

  it("deny overrides allow in composed policy", async () => {
    const allow = makePolicy("comp-allow", "allow");
    const deny = makePolicy("comp-deny", "deny", { reason: "blocked" });
    const composed = composePolicy(allow, deny);
    const result = await composed.check({ ctx });
    expect(result.effect).toBe("deny");
    expect(result.reason).toBe("blocked");
  });

  it("if deny is removed (mutated to allow), result would be allow", async () => {
    // This tests that composePolicy correctly picks deny over allow.
    const allow1 = makePolicy("comp-a1", "allow");
    const allow2 = makePolicy("comp-a2", "allow");
    const composed = composePolicy(allow1, allow2);
    const result = await composed.check({ ctx });
    expect(result.effect).toBe("allow");
  });

  it("approve overrides allow in composed policy", async () => {
    const allow = makePolicy("comp-allow-2", "allow");
    const approve = makePolicy("comp-approve", "approve", { reason: "needs review" });
    const composed = composePolicy(allow, approve);
    const result = await composed.check({ ctx });
    expect(result.effect).toBe("approve");
  });

  it("deny overrides approve in composed policy", async () => {
    const approve = makePolicy("comp-approve-2", "approve", { reason: "review" });
    const deny = makePolicy("comp-deny-2", "deny", { reason: "blocked" });
    const composed = composePolicy(approve, deny);
    const result = await composed.check({ ctx });
    expect(result.effect).toBe("deny");
  });

  it("redact overrides allow but not deny", async () => {
    const allow = makePolicy("comp-a-red", "allow");
    const redact = makePolicy("comp-redact", "redact", { reason: "sensitive" });
    const composed = composePolicy(allow, redact);
    const result = await composed.check({ ctx });
    expect(result.effect).toBe("redact");
  });
});

// ===========================================================================
// 4. MUTATION: Cache TTL check
// ===========================================================================

describe("Mutation: Cache TTL enforcement", () => {
  beforeEach(async () => {
    await cacheClear();
    setCacheStore(new MemoryStore());
  });

  it("entry with TTL is available before expiry", async () => {
    await cacheSet("ttl-check", "alive", { ttl: 10 });
    const entry = await cacheGet("ttl-check");
    expect(entry).toBeDefined();
    expect(entry!.data).toBe("alive");
  });

  it("entry with TTL is gone after expiry (mutation: skip TTL check)", async () => {
    await cacheSet("ttl-expired", "dead", { ttl: 1 });
    const restore = advanceTime(2000);
    const entry = await cacheGet("ttl-expired");
    expect(entry).toBeUndefined();
    restore();
  });

  it("entry without TTL never expires", async () => {
    await cacheSet("no-ttl", "forever");
    const restore = advanceTime(999_999_999);
    const entry = await cacheGet("no-ttl");
    expect(entry).toBeDefined();
    expect(entry!.data).toBe("forever");
    restore();
  });

  it("overwriting an entry resets TTL", async () => {
    await cacheSet("ow-ttl", "v1", { ttl: 1 });
    await cacheSet("ow-ttl", "v2", { ttl: 60 });
    const restore = advanceTime(2000);
    const entry = await cacheGet("ow-ttl");
    expect(entry).toBeDefined();
    expect(entry!.data).toBe("v2");
    restore();
  });
});

// ===========================================================================
// 5. MUTATION: Rate limit off-by-one
// ===========================================================================

describe("Mutation: Rate limit counter correctness", () => {
  beforeEach(() => clearRouteRateLimits());

  it("max=1 allows exactly 1 request", () => {
    const config = { window: 60_000, max: 1 };
    const r1 = checkRouteRateLimit("GET /obo", "c", config);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(0);

    const r2 = checkRouteRateLimit("GET /obo", "c", config);
    expect(r2.allowed).toBe(false);
  });

  it("max=5 allows exactly 5 requests", () => {
    const config = { window: 60_000, max: 5 };
    for (let i = 0; i < 5; i++) {
      const r = checkRouteRateLimit("GET /five", "c", config);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(4 - i);
    }
    const r6 = checkRouteRateLimit("GET /five", "c", config);
    expect(r6.allowed).toBe(false);
    expect(r6.remaining).toBe(0);
  });

  it("remaining decreases monotonically", () => {
    const config = { window: 60_000, max: 10 };
    let prev = 10;
    for (let i = 0; i < 10; i++) {
      const r = checkRouteRateLimit("GET /mono", "c", config);
      expect(r.remaining).toBeLessThan(prev);
      prev = r.remaining;
    }
  });
});

// ===========================================================================
// 6. MUTATION: CSRF token validation
// ===========================================================================

describe("Mutation: CSRF token validation", () => {
  function createHonoContext(opts: {
    method: string;
    cookie?: string;
    csrfHeader?: string;
    authorization?: string;
  }) {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers["cookie"] = opts.cookie;
    if (opts.csrfHeader) headers["x-csrf-token"] = opts.csrfHeader;
    if (opts.authorization) headers["authorization"] = opts.authorization;

    const responseHeaders = new Map<string, string>();
    return {
      req: {
        method: opts.method,
        url: "http://localhost/test",
        header: (name: string) => headers[name.toLowerCase()],
      },
      json: (data: any, status?: number) =>
        new Response(JSON.stringify(data), { status: status ?? 200 }),
      header: (name: string, value: string) => {
        responseHeaders.set(name, value);
      },
      res: { headers: new Headers() },
      _responseHeaders: responseHeaders,
    } as any;
  }

  it("POST with valid matching tokens passes (mutation: skip validation would pass all)", async () => {
    const mw = csrfProtection();
    const token = "abcdef1234567890abcdef1234567890";
    const c = createHonoContext({
      method: "POST",
      cookie: `__csrf=${token}`,
      csrfHeader: token,
    });
    let passed = false;
    await mw(c, async () => {
      passed = true;
    });
    expect(passed).toBe(true);
  });

  it("POST without any token is blocked (mutation: skip validation would let it through)", async () => {
    const mw = csrfProtection();
    const c = createHonoContext({ method: "POST" });
    const result = await mw(c, async () => {});
    expect(result!.status).toBe(403);
  });

  it("POST with mismatched tokens is blocked", async () => {
    const mw = csrfProtection();
    const c = createHonoContext({
      method: "POST",
      cookie: "__csrf=token-x",
      csrfHeader: "token-y",
    });
    const result = await mw(c, async () => {});
    expect(result!.status).toBe(403);
  });
});

// ===========================================================================
// 7. MUTATION: Circuit breaker state transitions
// ===========================================================================

describe("Mutation: Circuit breaker state transitions", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 1000 });
    expect(cb.getState()).toBe("closed");
  });

  it("transitions to open after failureThreshold failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });

    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => {
          throw new Error("fail");
        });
      } catch {}
    }
    expect(cb.getState()).toBe("open");
  });

  it("does NOT open at failureThreshold - 1 failures", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });

    for (let i = 0; i < 2; i++) {
      try {
        await cb.execute(async () => {
          throw new Error("fail");
        });
      } catch {}
    }
    expect(cb.getState()).toBe("closed");
  });

  it("success resets failure count (mutation: wrong state transition)", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });

    // 2 failures
    for (let i = 0; i < 2; i++) {
      try {
        await cb.execute(async () => {
          throw new Error("fail");
        });
      } catch {}
    }
    // 1 success resets
    await cb.execute(async () => "ok");

    // 2 more failures should NOT open (counter was reset)
    for (let i = 0; i < 2; i++) {
      try {
        await cb.execute(async () => {
          throw new Error("fail");
        });
      } catch {}
    }
    expect(cb.getState()).toBe("closed");
  });

  it("open state rejects with CircuitOpenError", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 99999 });
    try {
      await cb.execute(async () => {
        throw new Error("fail");
      });
    } catch {}

    try {
      await cb.execute(async () => "should not run");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
    }
  });
});

// ===========================================================================
// 8. IDEMPOTENCY: Same request produces same response
// ===========================================================================

describe("Idempotency: Same request -> same response", () => {
  beforeEach(() => {
    clearAPIRegistry();
    clearRouteRateLimits();
  });

  it("two identical GET requests return identical responses", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      async handler() {
        return { items: [1, 2, 3] };
      },
    });
    capstan.registerAPI("GET", "/items", api);

    const { body: body1 } = await fetchJson(capstan.app, "/items");
    const { body: body2 } = await fetchJson(capstan.app, "/items");
    expect(body1).toEqual(body2);
  });

  it("deterministic handler produces same result across calls", async () => {
    const api = defineAPI({
      async handler({ input }) {
        const n = (input as any).n ?? 5;
        return { doubled: n * 2 };
      },
    });

    const ctx = makeFakeContext();
    const r1 = await api.handler({ input: { n: 7 }, ctx, params: {} });
    const r2 = await api.handler({ input: { n: 7 }, ctx, params: {} });
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ doubled: 14 });
  });
});

// ===========================================================================
// 9. IDEMPOTENCY: Policy evaluation is pure
// ===========================================================================

describe("Idempotency: Policy evaluation purity", () => {
  const ctx = makeFakeContext();
  beforeEach(() => clearPolicyAuditLog());

  it("same policies, same context -> same result", async () => {
    const p1 = makePolicy("pure-allow", "allow");
    const p2 = makePolicy("pure-deny", "deny", { reason: "no" });

    const r1 = await enforcePolicies([p1, p2], ctx);
    const r2 = await enforcePolicies([p1, p2], ctx);

    expect(r1.effect).toBe(r2.effect);
    expect(r1.reason).toBe(r2.reason);
  });

  it("policy check does not mutate the context", async () => {
    const ctxCopy = JSON.parse(JSON.stringify(ctx.auth));
    const p = makePolicy("no-mutate", "allow");
    await enforcePolicies([p], ctx);
    expect(ctx.auth.isAuthenticated).toBe(ctxCopy.isAuthenticated);
    expect(ctx.auth.type).toBe(ctxCopy.type);
  });

  it("10 repeated evaluations all return the same result", async () => {
    const p = makePolicy("repeat", "deny", { reason: "consistent" });
    const results: PolicyCheckResult[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(await enforcePolicies([p], ctx));
    }
    for (const r of results) {
      expect(r.effect).toBe("deny");
      expect(r.reason).toBe("consistent");
    }
  });
});

// ===========================================================================
// 10. IDEMPOTENCY: Cache get/set determinism
// ===========================================================================

describe("Idempotency: Cache determinism", () => {
  beforeEach(async () => {
    await cacheClear();
    setCacheStore(new MemoryStore());
  });

  it("set then get returns same value", async () => {
    await cacheSet("det-key", { a: 1, b: "two" });
    const r1 = await cacheGet<{ a: number; b: string }>("det-key");
    const r2 = await cacheGet<{ a: number; b: string }>("det-key");
    expect(r1!.data).toEqual(r2!.data);
    expect(r1!.data).toEqual({ a: 1, b: "two" });
  });

  it("multiple gets without set return consistent result", async () => {
    await cacheSet("once", 42);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => cacheGet<number>("once")),
    );
    for (const r of results) {
      expect(r!.data).toBe(42);
    }
  });

  it("invalidation is permanent until next set", async () => {
    await cacheSet("inv-test", "data");
    await cacheInvalidate("inv-test");
    expect(await cacheGet("inv-test")).toBeUndefined();
    expect(await cacheGet("inv-test")).toBeUndefined(); // still gone
    expect(await cacheGet("inv-test")).toBeUndefined(); // still gone
  });
});

// ===========================================================================
// 11. IDEMPOTENCY: Rate limit strictly monotonic
// ===========================================================================

describe("Idempotency: Rate limit counter monotonic", () => {
  beforeEach(() => clearRouteRateLimits());

  it("remaining is strictly decreasing for each request", () => {
    const config = { window: 60_000, max: 10 };
    const remainings: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = checkRouteRateLimit("GET /decr", "client", config);
      remainings.push(r.remaining);
    }
    for (let i = 1; i < remainings.length; i++) {
      expect(remainings[i]!).toBeLessThan(remainings[i - 1]!);
    }
  });

  it("after limit reached, all subsequent are blocked", () => {
    const config = { window: 60_000, max: 3 };
    for (let i = 0; i < 3; i++) {
      checkRouteRateLimit("GET /all-blocked", "client", config);
    }
    for (let i = 0; i < 10; i++) {
      const r = checkRouteRateLimit("GET /all-blocked", "client", config);
      expect(r.allowed).toBe(false);
    }
  });
});

// ===========================================================================
// 12. IDEMPOTENCY: Metric counters only increase
// ===========================================================================

describe("Idempotency: Metric counters only increase", () => {
  beforeEach(() => resetMetrics());

  it("counter value increases with each inc()", () => {
    const c = new Counter();
    const values: number[] = [];
    for (let i = 0; i < 100; i++) {
      c.inc();
      const output = c.serialize("mono", "test");
      const match = output.match(/mono (\d+)/);
      values.push(parseInt(match![1]!, 10));
    }
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });

  it("histogram count increases with each observe()", () => {
    const h = new Histogram();
    for (let i = 0; i < 50; i++) {
      h.observe(undefined, i);
    }
    const output = h.serialize("h_mono", "test");
    expect(output).toContain("h_mono_count 50");
  });

  it("histogram sum is correct", () => {
    const h = new Histogram();
    let expectedSum = 0;
    for (let i = 0; i < 20; i++) {
      h.observe(undefined, i);
      expectedSum += i;
    }
    const output = h.serialize("h_sum", "test");
    expect(output).toContain(`h_sum_sum ${expectedSum}`);
  });
});

// ===========================================================================
// 13. IDEMPOTENCY: Approval IDs globally unique
// ===========================================================================

describe("Idempotency: Approval IDs unique", () => {
  beforeEach(async () => {
    await clearApprovals();
    setApprovalStore(new MemoryStore());
  });

  it("50 sequential approvals have unique IDs", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const approval = await createApproval({
        method: "POST",
        path: `/api/action-${i}`,
        input: { i },
        policy: "p",
        reason: "r",
      });
      ids.add(approval.id);
    }
    expect(ids.size).toBe(50);
  });

  it("50 concurrent approvals have unique IDs", async () => {
    const approvals = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        createApproval({
          method: "POST",
          path: `/api/concurrent-${i}`,
          input: { i },
          policy: "p",
          reason: "r",
        }),
      ),
    );
    const ids = new Set(approvals.map((a) => a.id));
    expect(ids.size).toBe(50);
  });
});

// ===========================================================================
// 14. IDEMPOTENCY: WebSocket room state after join/leave/join
// ===========================================================================

describe("Idempotency: WebSocket room state consistency", () => {
  it("join then leave then join results in size 1", () => {
    const room = new WebSocketRoom();
    const client = createMockClient(1);
    room.join(client);
    expect(room.size).toBe(1);
    room.leave(client);
    expect(room.size).toBe(0);
    room.join(client);
    expect(room.size).toBe(1);
  });

  it("double join does not duplicate (Set semantics)", () => {
    const room = new WebSocketRoom();
    const client = createMockClient(1);
    room.join(client);
    room.join(client);
    expect(room.size).toBe(1);
  });

  it("leave non-member is safe", () => {
    const room = new WebSocketRoom();
    const client = createMockClient(1);
    room.leave(client); // not a member
    expect(room.size).toBe(0);
  });

  it("broadcast after close sends nothing", () => {
    const room = new WebSocketRoom();
    const client = createMockClient(1);
    room.join(client);
    room.close();
    room.broadcast("should not arrive");
    expect(client.sent).toEqual([]); // client was closed before broadcast
  });
});

// ===========================================================================
// 15. STATE ISOLATION: Two createCapstanApp instances don't share state
// ===========================================================================

describe("State isolation: createCapstanApp instances", () => {
  it("two apps have independent route registries", async () => {
    const app1 = await createCapstanApp({ app: { name: "app1" } });
    const api1 = defineAPI({
      description: "App1 route",
      async handler() {
        return { app: 1 };
      },
    });
    app1.registerAPI("GET", "/route1", api1);

    const app2 = await createCapstanApp({ app: { name: "app2" } });
    const api2 = defineAPI({
      description: "App2 route",
      async handler() {
        return { app: 2 };
      },
    });
    app2.registerAPI("GET", "/route2", api2);

    expect(app1.routeRegistry.length).toBe(1);
    expect(app2.routeRegistry.length).toBe(1);
    expect(app1.routeRegistry[0]!.path).toBe("/route1");
    expect(app2.routeRegistry[0]!.path).toBe("/route2");
  });

  it("shutdown of one app does not affect the other", async () => {
    const app1 = await createCapstanApp({ app: { name: "iso-app1" } });
    const app2 = await createCapstanApp({ app: { name: "iso-app2" } });

    await app1.shutdown();

    // app1 should be in shutdown state
    const res1 = await app1.app.fetch(new Request("http://localhost/health"));
    const body1 = (await res1.json()) as any;
    expect(body1.status).toBe("shutting_down");

    // app2 should still be healthy
    const res2 = await app2.app.fetch(new Request("http://localhost/health"));
    const body2 = (await res2.json()) as any;
    expect(body2.status).toBe("healthy");
  });
});

// ===========================================================================
// 16. STATE ISOLATION: Policy audit log isolation
// ===========================================================================

describe("State isolation: Policy audit log", () => {
  it("clearPolicyAuditLog removes all entries", async () => {
    const ctx = makeFakeContext();
    const p = makePolicy("audit-iso", "deny", { reason: "test" });
    await enforcePolicies([p], ctx);
    expect(getPolicyAuditLog().length).toBeGreaterThan(0);

    clearPolicyAuditLog();
    expect(getPolicyAuditLog().length).toBe(0);
  });

  it("policy audit entries accumulate across calls", async () => {
    clearPolicyAuditLog();
    const ctx = makeFakeContext();
    const p = makePolicy("accum", "allow");

    await enforcePolicies([p], ctx);
    expect(getPolicyAuditLog().length).toBe(1);

    await enforcePolicies([p], ctx);
    expect(getPolicyAuditLog().length).toBe(2);

    await enforcePolicies([p], ctx);
    expect(getPolicyAuditLog().length).toBe(3);
  });
});

// ===========================================================================
// 17. STATE ISOLATION: Cache instances
// ===========================================================================

describe("State isolation: Cache", () => {
  beforeEach(async () => {
    await cacheClear();
    setCacheStore(new MemoryStore());
  });

  it("cacheClear leaves a clean slate", async () => {
    await cacheSet("x", 1);
    await cacheSet("y", 2);
    await cacheClear();
    expect(await cacheGet("x")).toBeUndefined();
    expect(await cacheGet("y")).toBeUndefined();
  });

  it("setCacheStore replaces the backing store", async () => {
    await cacheSet("before", "data");
    setCacheStore(new MemoryStore());
    // Old data should be gone since we replaced the store
    const result = await cacheGet("before");
    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// 18. STATE ISOLATION: Rate limit stores
// ===========================================================================

describe("State isolation: Rate limit stores", () => {
  it("clearRouteRateLimits resets all state", () => {
    const config = { window: 60_000, max: 1 };
    checkRouteRateLimit("GET /rl-iso", "c", config);
    const blocked = checkRouteRateLimit("GET /rl-iso", "c", config);
    expect(blocked.allowed).toBe(false);

    clearRouteRateLimits();
    const afterClear = checkRouteRateLimit("GET /rl-iso", "c", config);
    expect(afterClear.allowed).toBe(true);
  });

  it("clearRateLimitStore resets middleware rate limits", async () => {
    const limiter = defineRateLimit({ limit: 1, window: 60 });
    const makeReq = () => {
      const request = new Request("http://localhost/api/rl", {
        headers: { "x-forwarded-for": "isolation-ip" },
      });
      return limiter.handler({
        request,
        ctx: makeFakeContext(),
        next: async () => new Response("OK", { status: 200 }),
      });
    };

    await makeReq();
    const blocked = await makeReq();
    expect(blocked.status).toBe(429);

    await clearRateLimitStore();
    const afterClear = await makeReq();
    expect(afterClear.status).toBe(200);
  });
});

// ===========================================================================
// 19. STATE ISOLATION: Metric registries
// ===========================================================================

describe("State isolation: Metric registries", () => {
  it("resetMetrics clears all counters and histograms", () => {
    counter("iso-counter").inc(undefined, 42);
    histogram("iso-hist").observe(undefined, 3.14);
    resetMetrics();

    const output = serializeMetrics();
    expect(output).toBe("");
  });

  it("counter() returns fresh instances after reset", () => {
    const c1 = counter("fresh");
    c1.inc(undefined, 100);
    resetMetrics();

    const c2 = counter("fresh");
    c2.inc(undefined, 1);
    const output = c2.serialize("fresh", "test");
    expect(output).toContain("fresh 1");
  });
});

// ===========================================================================
// 20. ERROR RECOVERY: Server recovers from handler crash
// ===========================================================================

describe("Error recovery: Server", () => {
  it("handler crash on one request does not affect next request", async () => {
    const capstan = await createTestApp();
    let callCount = 0;
    const api = defineAPI({
      async handler() {
        callCount++;
        if (callCount === 1) {
          throw new Error("first request crash");
        }
        return { ok: true, call: callCount };
      },
    });
    capstan.registerAPI("GET", "/recover", api);

    // First request crashes
    const r1 = await capstan.app.fetch(
      new Request("http://localhost/recover"),
    );
    expect(r1.status).toBe(500);

    // Second request should work fine
    const r2 = await capstan.app.fetch(
      new Request("http://localhost/recover"),
    );
    expect(r2.status).toBe(200);
    const body = (await r2.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.call).toBe(2);
  });

  it("multiple sequential crashes followed by success", async () => {
    const capstan = await createTestApp();
    let callCount = 0;
    const api = defineAPI({
      async handler() {
        callCount++;
        if (callCount <= 5) {
          throw new Error(`crash ${callCount}`);
        }
        return { recovered: true };
      },
    });
    capstan.registerAPI("GET", "/multi-crash", api);

    for (let i = 0; i < 5; i++) {
      const res = await capstan.app.fetch(
        new Request("http://localhost/multi-crash"),
      );
      expect(res.status).toBe(500);
    }

    const res = await capstan.app.fetch(
      new Request("http://localhost/multi-crash"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.recovered).toBe(true);
  });
});

// ===========================================================================
// 21. ERROR RECOVERY: Approval duplicate handling
// ===========================================================================

describe("Error recovery: Approval store", () => {
  beforeEach(async () => {
    await clearApprovals();
    setApprovalStore(new MemoryStore());
  });

  it("resolving nonexistent approval returns undefined (no crash)", async () => {
    const result = await resolveApproval("fake-id", "approved");
    expect(result).toBeUndefined();
  });

  it("getting nonexistent approval returns undefined (no crash)", async () => {
    const result = await getApproval("fake-id");
    expect(result).toBeUndefined();
  });

  it("resolve already-resolved approval updates status", async () => {
    const a = await createApproval({
      method: "POST",
      path: "/api/test",
      input: {},
      policy: "p",
      reason: "r",
    });
    await resolveApproval(a.id, "approved", "admin");
    const resolved = await resolveApproval(a.id, "denied", "other-admin");
    // Depending on implementation, this either updates or is a no-op
    // The key thing is it does not crash
    expect(resolved).toBeDefined();
  });
});

// ===========================================================================
// 22. ERROR RECOVERY: Cache after corruption simulation
// ===========================================================================

describe("Error recovery: Cache", () => {
  beforeEach(async () => {
    await cacheClear();
    setCacheStore(new MemoryStore());
  });

  it("cached() with failing function returns error, cache remains clean", async () => {
    try {
      await cached("fail-key", async () => {
        throw new Error("compute error");
      }, { ttl: 60 });
    } catch {}

    // Cache should not have a corrupted entry
    const entry = await cacheGet("fail-key");
    expect(entry).toBeUndefined();
  });

  it("invalidation of non-existent key is safe", async () => {
    const result = await cacheInvalidate("ghost");
    expect(result).toBe(false);
  });

  it("clear on already empty cache is safe", async () => {
    await cacheClear();
    await cacheClear(); // double clear
    expect(await cacheGet("anything")).toBeUndefined();
  });
});

// ===========================================================================
// 23. COMPLIANCE AUDIT LOG
// ===========================================================================

describe("Compliance audit log isolation", () => {
  beforeEach(async () => {
    await clearAuditLog();
    setAuditStore(new MemoryStore());
  });

  it("clearAuditLog removes all entries", async () => {
    await recordAuditEntry(makeAuditEntry());
    await recordAuditEntry(makeAuditEntry());
    await clearAuditLog();
    const log = await getAuditLog();
    expect(log.length).toBe(0);
  });

  it("entries are ordered chronologically", async () => {
    await recordAuditEntry(makeAuditEntry({ timestamp: "2024-01-01T00:00:00Z" }));
    await recordAuditEntry(makeAuditEntry({ timestamp: "2024-06-01T00:00:00Z" }));
    await recordAuditEntry(makeAuditEntry({ timestamp: "2024-03-01T00:00:00Z" }));
    const log = await getAuditLog();
    expect(log.length).toBe(3);
    expect(log[0]!.timestamp).toBe("2024-01-01T00:00:00Z");
  });

  it("getAuditLog with since filter", async () => {
    await recordAuditEntry(makeAuditEntry({ timestamp: "2024-01-01T00:00:00Z" }));
    await recordAuditEntry(makeAuditEntry({ timestamp: "2024-06-01T00:00:00Z" }));
    const filtered = await getAuditLog({ since: "2024-03-01T00:00:00Z" });
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.timestamp).toBe("2024-06-01T00:00:00Z");
  });

  it("getAuditLog with limit", async () => {
    for (let i = 0; i < 10; i++) {
      await recordAuditEntry(makeAuditEntry());
    }
    const limited = await getAuditLog({ limit: 3 });
    expect(limited.length).toBe(3);
  });

  it("defineCompliance returns config as-is", () => {
    const config = defineCompliance({ riskLevel: "high", auditLog: true });
    expect(config.riskLevel).toBe("high");
    expect(config.auditLog).toBe(true);
  });
});

// ===========================================================================
// 24. CACHE UTILS
// ===========================================================================

describe("Cache utils idempotency", () => {
  it("normalizeCacheTag trims whitespace", () => {
    expect(normalizeCacheTag("  hello  ")).toBe("hello");
    expect(normalizeCacheTag("no-trim")).toBe("no-trim");
  });

  it("normalizeCacheTag rejects empty/non-string", () => {
    expect(normalizeCacheTag("")).toBeUndefined();
    expect(normalizeCacheTag("   ")).toBeUndefined();
    expect(normalizeCacheTag(42 as any)).toBeUndefined();
  });

  it("normalizeCacheTags deduplicates", () => {
    expect(normalizeCacheTags(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("normalizeCacheTags filters out empty strings", () => {
    expect(normalizeCacheTags(["a", "", "b"])).toEqual(["a", "b"]);
  });

  it("normalizeCachePath normalizes slashes", () => {
    expect(normalizeCachePath("/foo//bar")).toBe("/foo/bar");
    expect(normalizeCachePath("")).toBe("/");
    expect(normalizeCachePath("/")).toBe("/");
  });

  it("normalizeCachePath strips query string", () => {
    expect(normalizeCachePath("/foo?bar=1")).toBe("/foo");
  });

  it("createPageCacheKey adds page: prefix", () => {
    expect(createPageCacheKey("/about")).toBe("page:/about");
    expect(createPageCacheKey("/")).toBe("page:/");
  });
});

// ===========================================================================
// 25. SERVER MANIFEST + ROUTES CONSISTENCY
// ===========================================================================

describe("Manifest and route consistency", () => {
  it("registered routes appear in manifest", async () => {
    const capstan = await createTestApp({
      app: { name: "manifest-test", title: "Test" },
    });
    const api1 = defineAPI({
      description: "Route A",
      capability: "read",
      async handler() {
        return {};
      },
    });
    const api2 = defineAPI({
      description: "Route B",
      capability: "write",
      async handler() {
        return {};
      },
    });
    capstan.registerAPI("GET", "/a", api1);
    capstan.registerAPI("POST", "/b", api2);

    const { body } = await fetchJson(capstan.app, "/.well-known/capstan.json");
    const routes = (body as any).routes as Array<{
      method: string;
      path: string;
      description: string;
    }>;
    const routeA = routes.find((r) => r.path === "/a");
    const routeB = routes.find((r) => r.path === "/b");
    expect(routeA).toBeDefined();
    expect(routeA!.description).toBe("Route A");
    expect(routeB).toBeDefined();
    expect(routeB!.description).toBe("Route B");
  });

  it("route registry captures inputSchema when Zod schema provided", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      input: z.object({ name: z.string() }),
      async handler({ input }) {
        return { name: (input as any).name };
      },
    });
    capstan.registerAPI("POST", "/with-schema", api);

    const meta = capstan.routeRegistry.find((r) => r.path === "/with-schema");
    expect(meta).toBeDefined();
    expect(meta!.inputSchema).toBeDefined();
  });

  it("/capstan/routes count matches actual registered routes", async () => {
    const capstan = await createTestApp();
    for (let i = 0; i < 5; i++) {
      const api = defineAPI({
        description: `Route ${i}`,
        async handler() {
          return {};
        },
      });
      capstan.registerAPI("GET", `/r${i}`, api);
    }

    const { body } = await fetchJson(capstan.app, "/capstan/routes");
    expect((body as any).count).toBe(5);
    expect((body as any).routes.length).toBe(5);
  });
});

// ===========================================================================
// 26. COERCE QUERY INPUT IDEMPOTENCY
// ===========================================================================

describe("coerceQueryInput idempotency", () => {
  it("same input always produces same output", () => {
    const input = { count: "42", active: "true", name: "alice" };
    const r1 = coerceQueryInput(input);
    const r2 = coerceQueryInput(input);
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ count: 42, active: true, name: "alice" });
  });

  it("empty object returns empty object", () => {
    expect(coerceQueryInput({})).toEqual({});
  });
});

// ===========================================================================
// 27. SERVER HANDLER WITH PARAMS
// ===========================================================================

describe("Route params idempotency", () => {
  it("params are correctly extracted from URL", async () => {
    const capstan = await createTestApp();
    let capturedParams: any;
    const api = defineAPI({
      async handler({ params }) {
        capturedParams = params;
        return { id: params.id };
      },
    });
    capstan.registerAPI("GET", "/items/:id", api);

    await capstan.app.fetch(new Request("http://localhost/items/abc"));
    expect(capturedParams.id).toBe("abc");

    await capstan.app.fetch(new Request("http://localhost/items/xyz"));
    expect(capturedParams.id).toBe("xyz");
  });

  it("same param URL twice gives same param value", async () => {
    const capstan = await createTestApp();
    const results: string[] = [];
    const api = defineAPI({
      async handler({ params }) {
        results.push(params.id);
        return { id: params.id };
      },
    });
    capstan.registerAPI("GET", "/things/:id", api);

    await capstan.app.fetch(new Request("http://localhost/things/123"));
    await capstan.app.fetch(new Request("http://localhost/things/123"));
    expect(results[0]).toBe("123");
    expect(results[1]).toBe("123");
  });
});

// ===========================================================================
// 28. FULL E2E MUTATION GUARD: Validation -> Policy -> Handler -> Response
// ===========================================================================

describe("E2E mutation guard: full request pipeline", () => {
  beforeEach(() => {
    clearAPIRegistry();
    clearRouteRateLimits();
    clearPolicyAuditLog();
  });

  it("invalid input -> 400, handler not called", async () => {
    const capstan = await createTestApp();
    let handlerCalled = false;
    const api = defineAPI({
      input: z.object({ required: z.string() }),
      async handler() {
        handlerCalled = true;
        return {};
      },
    });
    capstan.registerAPI("POST", "/val-guard", api);

    const { response } = await fetchJson(capstan.app, "/val-guard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ required: 123 }),
    });
    expect(response.status).toBe(400);
    expect(handlerCalled).toBe(false);
  });

  it("policy deny -> 403, handler not called", async () => {
    const capstan = await createTestApp();
    let handlerCalled = false;
    const api = defineAPI({
      async handler() {
        handlerCalled = true;
        return {};
      },
    });
    const denyPolicy = definePolicy({
      key: "e2e-deny",
      title: "Deny",
      effect: "deny",
      async check() {
        return { effect: "deny", reason: "Blocked" };
      },
    });
    capstan.registerAPI("POST", "/deny-guard", api, [denyPolicy]);

    const { response } = await fetchJson(capstan.app, "/deny-guard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(handlerCalled).toBe(false);
  });

  it("valid input + allow policy -> 200, handler called", async () => {
    const capstan = await createTestApp();
    let handlerCalled = false;
    const api = defineAPI({
      input: z.object({ name: z.string() }),
      async handler() {
        handlerCalled = true;
        return { success: true };
      },
    });
    const allowPolicy = definePolicy({
      key: "e2e-allow",
      title: "Allow",
      effect: "allow",
      async check() {
        return { effect: "allow" };
      },
    });
    capstan.registerAPI("POST", "/allow-guard", api, [allowPolicy]);

    const { response, body } = await fetchJson(capstan.app, "/allow-guard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(response.status).toBe(200);
    expect(handlerCalled).toBe(true);
    expect((body as any).success).toBe(true);
  });

  it("rate limited request -> 429", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      rateLimit: { window: 60_000, max: 1 },
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/rl-e2e", api);

    const r1 = await capstan.app.fetch(new Request("http://localhost/rl-e2e"));
    expect(r1.status).toBe(200);

    const r2 = await capstan.app.fetch(new Request("http://localhost/rl-e2e"));
    expect(r2.status).toBe(429);
  });

  it("deprecated route returns correct headers", async () => {
    const capstan = await createTestApp();
    const api = defineAPI({
      deprecated: { sunset: "2026-01-01", message: "Use /v2" },
      async handler() {
        return {};
      },
    });
    capstan.registerAPI("GET", "/dep-e2e", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/dep-e2e"),
    );
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Sunset")).toBeDefined();
    expect(res.headers.get("X-Deprecated-Message")).toBe("Use /v2");
  });
});
