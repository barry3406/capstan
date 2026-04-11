import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  defineRateLimit,
  clearRateLimitStore,
} from "@zauso-ai/capstan-core";
import type {
  CapstanContext,
  MiddlewareDefinition,
} from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal CapstanContext with sensible defaults. */
function makeCtx(
  overrides: Partial<CapstanContext["auth"]> = {},
): CapstanContext {
  return {
    auth: {
      isAuthenticated: false,
      type: "anonymous",
      permissions: [],
      ...overrides,
    },
    request: new Request("http://localhost/test"),
    env: {},
    honoCtx: {} as CapstanContext["honoCtx"],
  };
}

/** Create a Request with arbitrary headers. */
function makeRequest(
  headers: Record<string, string> = {},
  url = "http://localhost/test",
): Request {
  return new Request(url, { headers });
}

/** The trivial downstream handler used by `next()`. */
function okNext(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/**
 * Invoke a MiddlewareDefinition's handler with the given parameters.
 * Returns the Response object for assertion.
 */
async function invoke(
  mw: MiddlewareDefinition,
  opts: {
    request?: Request;
    ctx?: CapstanContext;
    next?: () => Promise<Response>;
  } = {},
): Promise<Response> {
  const request = opts.request ?? makeRequest({ "x-forwarded-for": "1.2.3.4" });
  const ctx = opts.ctx ?? makeCtx();
  const next = opts.next ?? okNext;
  return mw.handler({ request, ctx, next });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearRateLimitStore();
});

afterEach(() => {
  clearRateLimitStore();
});

// ---------------------------------------------------------------------------
// Happy Path
// ---------------------------------------------------------------------------

describe("defineRateLimit — happy path", () => {
  it("allows requests under the limit", async () => {
    const mw = defineRateLimit({ limit: 5, window: 60 });
    const res = await invoke(mw);
    expect(res.status).toBe(200);
  });

  it("returns 429 when limit exceeded", async () => {
    const mw = defineRateLimit({ limit: 2, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.0.0.1" });
    const ctx = makeCtx();

    await invoke(mw, { request, ctx });
    await invoke(mw, { request, ctx });
    const res = await invoke(mw, { request, ctx });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe("Too Many Requests");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it("resets after window expires", async () => {
    const mw = defineRateLimit({ limit: 1, window: 1 }); // 1 s window
    const request = makeRequest({ "x-forwarded-for": "10.0.0.2" });
    const ctx = makeCtx();

    // Exhaust the limit.
    await invoke(mw, { request, ctx });
    const blocked = await invoke(mw, { request, ctx });
    expect(blocked.status).toBe(429);

    // Wait for the window to expire.
    await new Promise((r) => setTimeout(r, 1100));

    const unblocked = await invoke(mw, { request, ctx });
    expect(unblocked.status).toBe(200);
  });

  it("adds X-RateLimit-Limit header to responses", async () => {
    const mw = defineRateLimit({ limit: 50, window: 60 });
    const res = await invoke(mw);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("50");
  });

  it("adds X-RateLimit-Remaining header that decrements correctly", async () => {
    const mw = defineRateLimit({ limit: 3, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.0.0.3" });
    const ctx = makeCtx();

    const r1 = await invoke(mw, { request, ctx });
    expect(r1.headers.get("X-RateLimit-Remaining")).toBe("2");

    const r2 = await invoke(mw, { request, ctx });
    expect(r2.headers.get("X-RateLimit-Remaining")).toBe("1");

    const r3 = await invoke(mw, { request, ctx });
    expect(r3.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("adds X-RateLimit-Reset header to responses", async () => {
    const mw = defineRateLimit({ limit: 10, window: 60 });
    const before = Math.ceil(Date.now() / 1000);
    const res = await invoke(mw);
    const after = Math.ceil(Date.now() / 1000);

    const reset = Number(res.headers.get("X-RateLimit-Reset"));
    // Reset should be roughly now + window seconds.
    expect(reset).toBeGreaterThanOrEqual(before + 60);
    expect(reset).toBeLessThanOrEqual(after + 61);
  });

  it("adds Retry-After header on 429", async () => {
    const mw = defineRateLimit({ limit: 1, window: 30 });
    const request = makeRequest({ "x-forwarded-for": "10.0.0.4" });
    const ctx = makeCtx();

    await invoke(mw, { request, ctx });
    const res = await invoke(mw, { request, ctx });

    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// Auth Type Differentiation
// ---------------------------------------------------------------------------

describe("defineRateLimit — auth type differentiation", () => {
  it("uses byAuthType.human limit for human auth", async () => {
    const mw = defineRateLimit({
      limit: 100,
      window: 60,
      byAuthType: { human: 2 },
    });
    const request = makeRequest({ "x-forwarded-for": "10.1.0.1" });
    const ctx = makeCtx({ type: "human", isAuthenticated: true });

    await invoke(mw, { request, ctx });
    await invoke(mw, { request, ctx });
    const res = await invoke(mw, { request, ctx });
    expect(res.status).toBe(429);
  });

  it("uses byAuthType.agent limit for agent auth", async () => {
    const mw = defineRateLimit({
      limit: 100,
      window: 60,
      byAuthType: { agent: 3 },
    });
    const request = makeRequest({ "x-forwarded-for": "10.1.0.2" });
    const ctx = makeCtx({
      type: "agent",
      isAuthenticated: true,
      agentId: "bot-1",
    });

    // 3 allowed, 4th rejected
    for (let i = 0; i < 3; i++) {
      const r = await invoke(mw, { request, ctx });
      expect(r.status).toBe(200);
    }
    const res = await invoke(mw, { request, ctx });
    expect(res.status).toBe(429);
  });

  it("uses byAuthType.anonymous limit for anonymous", async () => {
    const mw = defineRateLimit({
      limit: 100,
      window: 60,
      byAuthType: { anonymous: 1 },
    });
    const request = makeRequest({ "x-forwarded-for": "10.1.0.3" });
    const ctx = makeCtx({ type: "anonymous" });

    await invoke(mw, { request, ctx });
    const res = await invoke(mw, { request, ctx });
    expect(res.status).toBe(429);
  });

  it("uses byAuthType.workload limit for workload auth", async () => {
    const mw = defineRateLimit({
      limit: 100,
      window: 60,
      byAuthType: { workload: 30 },
    });
    const request = makeRequest({ "x-forwarded-for": "10.1.0.10" });
    const ctx = makeCtx({ type: "workload", isAuthenticated: true });

    // 30 allowed, 31st rejected
    for (let i = 0; i < 30; i++) {
      const r = await invoke(mw, { request, ctx });
      expect(r.status).toBe(200);
    }
    const res = await invoke(mw, { request, ctx });
    expect(res.status).toBe(429);
  });

  it("falls back to default limit when auth type not in byAuthType", async () => {
    const mw = defineRateLimit({
      limit: 2,
      window: 60,
      byAuthType: { agent: 50 }, // only agent is overridden
    });
    const request = makeRequest({ "x-forwarded-for": "10.1.0.4" });
    const ctx = makeCtx({ type: "human", isAuthenticated: true });

    // Human is not in byAuthType, so default limit of 2 applies.
    await invoke(mw, { request, ctx });
    await invoke(mw, { request, ctx });
    const res = await invoke(mw, { request, ctx });
    expect(res.status).toBe(429);
  });

  it("same IP shares one bucket across auth types with per-type limits", async () => {
    const mw = defineRateLimit({
      limit: 100,
      window: 60,
      byAuthType: { human: 1, agent: 1 },
    });

    // Human client
    const humanReq = makeRequest({ "x-forwarded-for": "10.1.0.5" });
    const humanCtx = makeCtx({ type: "human", isAuthenticated: true });
    const humanR1 = await invoke(mw, { request: humanReq, ctx: humanCtx });
    expect(humanR1.status).toBe(200);
    const humanR2 = await invoke(mw, { request: humanReq, ctx: humanCtx });
    expect(humanR2.status).toBe(429);

    // Agent client from same IP — same bucket (keyed by IP by default).
    // The bucket already has 1 timestamp from the human request, and the
    // agent limit is also 1, so the agent is immediately rate-limited.
    const agentReq = makeRequest({ "x-forwarded-for": "10.1.0.5" });
    const agentCtx = makeCtx({
      type: "agent",
      isAuthenticated: true,
      agentId: "bot-2",
    });
    const agentR1 = await invoke(mw, { request: agentReq, ctx: agentCtx });
    expect(agentR1.status).toBe(429);

    // Agent client from different IP — separate bucket, so allowed.
    const agentReq2 = makeRequest({ "x-forwarded-for": "10.1.0.6" });
    const agentR2 = await invoke(mw, {
      request: agentReq2,
      ctx: agentCtx,
    });
    expect(agentR2.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Key Extraction
// ---------------------------------------------------------------------------

describe("defineRateLimit — key extraction", () => {
  it("keyBy: ip extracts from X-Forwarded-For", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60, keyBy: "ip" });

    const req1 = makeRequest({ "x-forwarded-for": "192.168.1.1" });
    const r1 = await invoke(mw, { request: req1 });
    expect(r1.status).toBe(200);

    // Same IP => blocked.
    const req2 = makeRequest({ "x-forwarded-for": "192.168.1.1" });
    const r2 = await invoke(mw, { request: req2 });
    expect(r2.status).toBe(429);

    // Different IP => allowed.
    const req3 = makeRequest({ "x-forwarded-for": "192.168.1.2" });
    const r3 = await invoke(mw, { request: req3 });
    expect(r3.status).toBe(200);
  });

  it("keyBy: ip extracts from X-Real-Ip", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60, keyBy: "ip" });

    const req1 = makeRequest({ "x-real-ip": "10.20.30.40" });
    const r1 = await invoke(mw, { request: req1 });
    expect(r1.status).toBe(200);

    const req2 = makeRequest({ "x-real-ip": "10.20.30.40" });
    const r2 = await invoke(mw, { request: req2 });
    expect(r2.status).toBe(429);
  });

  it("keyBy: ip falls back to 'unknown' when no IP headers", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60, keyBy: "ip" });

    // No IP headers at all.
    const req1 = makeRequest({});
    const r1 = await invoke(mw, { request: req1 });
    expect(r1.status).toBe(200);

    // Second request with no headers also maps to "unknown" => blocked.
    const req2 = makeRequest({});
    const r2 = await invoke(mw, { request: req2 });
    expect(r2.status).toBe(429);
  });

  it("keyBy: userId uses authenticated user ID", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60, keyBy: "userId" });

    const ctx = makeCtx({
      type: "human",
      isAuthenticated: true,
      userId: "user-42",
    });

    const r1 = await invoke(mw, {
      request: makeRequest({ "x-forwarded-for": "1.1.1.1" }),
      ctx,
    });
    expect(r1.status).toBe(200);

    // Same userId, different IP => still blocked (keyed by userId).
    const r2 = await invoke(mw, {
      request: makeRequest({ "x-forwarded-for": "2.2.2.2" }),
      ctx,
    });
    expect(r2.status).toBe(429);
  });

  it("keyBy: apiKey uses agent ID", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60, keyBy: "apiKey" });

    const ctx = makeCtx({
      type: "agent",
      isAuthenticated: true,
      agentId: "agent-abc",
    });

    const r1 = await invoke(mw, {
      request: makeRequest({ "x-forwarded-for": "3.3.3.3" }),
      ctx,
    });
    expect(r1.status).toBe(200);

    // Same agentId, different IP => blocked.
    const r2 = await invoke(mw, {
      request: makeRequest({ "x-forwarded-for": "4.4.4.4" }),
      ctx,
    });
    expect(r2.status).toBe(429);
  });

  it("multiple IPs in X-Forwarded-For uses first", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60, keyBy: "ip" });

    // The first IP in the chain is the client IP.
    const req = makeRequest({
      "x-forwarded-for": "100.0.0.1, 200.0.0.1, 300.0.0.1",
    });
    const r1 = await invoke(mw, { request: req });
    expect(r1.status).toBe(200);

    // Same first IP.
    const req2 = makeRequest({
      "x-forwarded-for": "100.0.0.1, 999.0.0.1",
    });
    const r2 = await invoke(mw, { request: req2 });
    expect(r2.status).toBe(429);
  });

  it("default keyBy behaviour is ip", async () => {
    // No keyBy specified — should default to IP extraction.
    const mw = defineRateLimit({ limit: 1, window: 60 });

    const req1 = makeRequest({ "x-forwarded-for": "172.16.0.1" });
    const r1 = await invoke(mw, { request: req1 });
    expect(r1.status).toBe(200);

    const req2 = makeRequest({ "x-forwarded-for": "172.16.0.1" });
    const r2 = await invoke(mw, { request: req2 });
    expect(r2.status).toBe(429);

    // Different IP still allowed.
    const req3 = makeRequest({ "x-forwarded-for": "172.16.0.2" });
    const r3 = await invoke(mw, { request: req3 });
    expect(r3.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Boundary Conditions
// ---------------------------------------------------------------------------

describe("defineRateLimit — boundary conditions", () => {
  it("exactly at the limit (last allowed request)", async () => {
    const mw = defineRateLimit({ limit: 3, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.2.0.1" });
    const ctx = makeCtx();

    // Requests 1 and 2.
    await invoke(mw, { request, ctx });
    await invoke(mw, { request, ctx });

    // Request 3 — exactly at limit — should still succeed.
    const r3 = await invoke(mw, { request, ctx });
    expect(r3.status).toBe(200);
    expect(r3.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("one over the limit (first rejected)", async () => {
    const mw = defineRateLimit({ limit: 3, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.2.0.2" });
    const ctx = makeCtx();

    for (let i = 0; i < 3; i++) {
      await invoke(mw, { request, ctx });
    }

    // 4th request — one over — must be 429.
    const r4 = await invoke(mw, { request, ctx });
    expect(r4.status).toBe(429);
    expect(r4.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("window boundary: request at exactly window expiry", async () => {
    // Use a very short window so we can test the boundary precisely.
    const mw = defineRateLimit({ limit: 1, window: 1 });
    const request = makeRequest({ "x-forwarded-for": "10.2.0.3" });
    const ctx = makeCtx();

    await invoke(mw, { request, ctx });

    // Wait exactly 1 second for the window to expire.
    await new Promise((r) => setTimeout(r, 1050));

    const res = await invoke(mw, { request, ctx });
    expect(res.status).toBe(200);
  });

  it("limit: 1 (single request allowed)", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.2.0.4" });
    const ctx = makeCtx();

    const r1 = await invoke(mw, { request, ctx });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("X-RateLimit-Remaining")).toBe("0");

    const r2 = await invoke(mw, { request, ctx });
    expect(r2.status).toBe(429);
  });

  it("limit: 0 (all requests rejected)", async () => {
    const mw = defineRateLimit({ limit: 0, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.2.0.5" });
    const ctx = makeCtx();

    // Even the very first request should be rejected.
    const r1 = await invoke(mw, { request, ctx });
    expect(r1.status).toBe(429);
  });

  it("limit: -1 (negative limit rejects all requests)", async () => {
    // timestamps.length >= -1 is always true, so every request is rejected.
    const mw = defineRateLimit({ limit: -1, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.2.0.9" });
    const ctx = makeCtx();

    const r1 = await invoke(mw, { request, ctx });
    expect(r1.status).toBe(429);

    const r2 = await invoke(mw, { request, ctx });
    expect(r2.status).toBe(429);
  });

  it("very short window (100ms)", async () => {
    const mw = defineRateLimit({ limit: 1, window: 0.1 }); // 100ms
    const request = makeRequest({ "x-forwarded-for": "10.2.0.6" });
    const ctx = makeCtx();

    const r1 = await invoke(mw, { request, ctx });
    expect(r1.status).toBe(200);

    const r2 = await invoke(mw, { request, ctx });
    expect(r2.status).toBe(429);

    // Wait for the tiny window to expire.
    await new Promise((r) => setTimeout(r, 150));

    const r3 = await invoke(mw, { request, ctx });
    expect(r3.status).toBe(200);
  });

  it("clearRateLimitStore() resets all counters", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.2.0.7" });
    const ctx = makeCtx();

    await invoke(mw, { request, ctx });
    const blocked = await invoke(mw, { request, ctx });
    expect(blocked.status).toBe(429);

    clearRateLimitStore();

    const unblocked = await invoke(mw, { request, ctx });
    expect(unblocked.status).toBe(200);
  });

  it("multiple clients tracked independently", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60 });
    const ctx = makeCtx();

    const reqA = makeRequest({ "x-forwarded-for": "10.3.0.1" });
    const reqB = makeRequest({ "x-forwarded-for": "10.3.0.2" });
    const reqC = makeRequest({ "x-forwarded-for": "10.3.0.3" });

    // Each client gets exactly 1 request.
    const rA = await invoke(mw, { request: reqA, ctx });
    const rB = await invoke(mw, { request: reqB, ctx });
    const rC = await invoke(mw, { request: reqC, ctx });
    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);
    expect(rC.status).toBe(200);

    // Each client is now rate-limited independently.
    const rA2 = await invoke(mw, { request: reqA, ctx });
    const rB2 = await invoke(mw, { request: reqB, ctx });
    const rC2 = await invoke(mw, { request: reqC, ctx });
    expect(rA2.status).toBe(429);
    expect(rB2.status).toBe(429);
    expect(rC2.status).toBe(429);
  });

  it("rapid sequential requests within same millisecond", async () => {
    const mw = defineRateLimit({ limit: 5, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.2.0.8" });
    const ctx = makeCtx();

    // Fire many requests as fast as possible — no awaiting in between
    // except as needed for the handler (which is sync-like here).
    const results: Response[] = [];
    for (let i = 0; i < 8; i++) {
      results.push(await invoke(mw, { request, ctx }));
    }

    // First 5 should succeed.
    for (let i = 0; i < 5; i++) {
      expect(results[i]!.status).toBe(200);
    }
    // Remaining 3 should be rejected.
    for (let i = 5; i < 8; i++) {
      expect(results[i]!.status).toBe(429);
    }
  });
});

// ---------------------------------------------------------------------------
// Error / Edge Cases
// ---------------------------------------------------------------------------

describe("defineRateLimit — error cases", () => {
  it("missing auth context defaults to anonymous handling", async () => {
    const mw = defineRateLimit({
      limit: 100,
      window: 60,
      byAuthType: { anonymous: 1 },
    });

    // Context with anonymous type (default).
    const ctx = makeCtx();
    const request = makeRequest({ "x-forwarded-for": "10.4.0.1" });

    const r1 = await invoke(mw, { request, ctx });
    expect(r1.status).toBe(200);
    // Anonymous limit is 1, so second request is blocked.
    const r2 = await invoke(mw, { request, ctx });
    expect(r2.status).toBe(429);
  });

  it("request with no headers at all still works", async () => {
    const mw = defineRateLimit({ limit: 2, window: 60 });
    const request = makeRequest({});
    const ctx = makeCtx();

    // Falls back to "unknown" key — should still function.
    const r1 = await invoke(mw, { request, ctx });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(r1.headers.get("X-RateLimit-Remaining")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// MiddlewareDefinition shape
// ---------------------------------------------------------------------------

describe("defineRateLimit — definition shape", () => {
  it("returns a MiddlewareDefinition with name 'rateLimit'", () => {
    const mw = defineRateLimit({ limit: 10, window: 60 });
    expect(mw.name).toBe("rateLimit");
    expect(typeof mw.handler).toBe("function");
  });

  it("propagates the downstream response body on success", async () => {
    const mw = defineRateLimit({ limit: 10, window: 60 });
    const downstream = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: "hello" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const res = await invoke(mw, { next: downstream });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: string };
    expect(body.data).toBe("hello");
  });

  it("preserves downstream response status and statusText", async () => {
    const mw = defineRateLimit({ limit: 10, window: 60 });
    const downstream = () =>
      Promise.resolve(
        new Response(null, { status: 201, statusText: "Created" }),
      );

    const res = await invoke(mw, { next: downstream });
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
  });

  it("429 response body contains retryAfter as a number", async () => {
    const mw = defineRateLimit({ limit: 1, window: 30 });
    const request = makeRequest({ "x-forwarded-for": "10.5.0.1" });
    const ctx = makeCtx();

    await invoke(mw, { request, ctx });
    const res = await invoke(mw, { request, ctx });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(typeof body.retryAfter).toBe("number");
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(body.retryAfter).toBeLessThanOrEqual(30);
  });

  it("429 response includes all X-RateLimit headers", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60 });
    const request = makeRequest({ "x-forwarded-for": "10.5.0.2" });
    const ctx = makeCtx();

    await invoke(mw, { request, ctx });
    const res = await invoke(mw, { request, ctx });

    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    const nowSec = Math.floor(Date.now() / 1000);
    const resetValue = Number(res.headers.get("X-RateLimit-Reset"));
    expect(resetValue).toBeGreaterThan(nowSec);
    expect(resetValue).toBeLessThanOrEqual(nowSec + 61);
    const retryAfterValue = Number(res.headers.get("Retry-After"));
    expect(retryAfterValue).toBeGreaterThanOrEqual(1);
    expect(retryAfterValue).toBeLessThanOrEqual(60);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("keyBy: userId falls back to IP when userId is missing", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60, keyBy: "userId" });

    // Anonymous context — no userId present.
    const ctx = makeCtx({ type: "anonymous" });
    const request = makeRequest({ "x-forwarded-for": "10.5.0.3" });

    const r1 = await invoke(mw, { request, ctx });
    expect(r1.status).toBe(200);

    // Same IP, still no userId => falls back to same IP key.
    const r2 = await invoke(mw, { request, ctx });
    expect(r2.status).toBe(429);
  });

  it("keyBy: apiKey falls back to IP when agentId is missing", async () => {
    const mw = defineRateLimit({ limit: 1, window: 60, keyBy: "apiKey" });

    // Human context — no agentId present.
    const ctx = makeCtx({ type: "human", isAuthenticated: true });
    const request = makeRequest({ "x-forwarded-for": "10.5.0.4" });

    const r1 = await invoke(mw, { request, ctx });
    expect(r1.status).toBe(200);

    const r2 = await invoke(mw, { request, ctx });
    expect(r2.status).toBe(429);
  });
});
