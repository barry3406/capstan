import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import {
  responseCacheClear,
  responseCacheGet,
  responseCacheSet,
  setResponseCacheStore,
  MemoryStore,
} from "@zauso-ai/capstan-core";
import type { ResponseCacheEntry } from "@zauso-ai/capstan-core";
import {
  createStrategy,
  SSRStrategy,
  ISRStrategy,
  SSGStrategy,
} from "@zauso-ai/capstan-react";
import type { RenderStrategyContext } from "@zauso-ai/capstan-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal page module — we can't run real React SSR in a unit test. */
function makeFakePageModule() {
  return {
    default: () => null as never,
    loader: undefined,
  };
}

function makeISRCtx(url: string, revalidate?: number): RenderStrategyContext {
  const request = new Request(`http://localhost${url}`);
  return {
    options: {
      pageModule: makeFakePageModule(),
      layouts: [],
      params: {},
      request,
      loaderArgs: {
        params: {},
        request,
        ctx: { auth: { isAuthenticated: false, type: "anonymous" as const } },
        fetch: {
          get: async () => null,
          post: async () => null,
          put: async () => null,
          delete: async () => null,
        },
      },
    },
    url,
    revalidate,
    cacheTags: ["posts"],
  };
}

beforeEach(async () => {
  await responseCacheClear();
  setResponseCacheStore(new MemoryStore<ResponseCacheEntry>());
});

// ---------------------------------------------------------------------------
// createStrategy factory
// ---------------------------------------------------------------------------

describe("createStrategy", () => {
  test('returns SSRStrategy for "ssr"', () => {
    expect(createStrategy("ssr")).toBeInstanceOf(SSRStrategy);
  });

  test('returns ISRStrategy for "isr"', () => {
    expect(createStrategy("isr")).toBeInstanceOf(ISRStrategy);
  });

  test('returns SSGStrategy for "ssg"', () => {
    expect(createStrategy("ssg")).toBeInstanceOf(SSGStrategy);
  });

  test('returns SSRStrategy for "streaming" (falls through)', () => {
    expect(createStrategy("streaming")).toBeInstanceOf(SSRStrategy);
  });

  test("returns SSRStrategy for unknown value (default branch)", () => {
    expect(createStrategy("future-mode" as never)).toBeInstanceOf(SSRStrategy);
  });
});

// ---------------------------------------------------------------------------
// ISRStrategy — cache interaction tests
// ---------------------------------------------------------------------------

describe("ISRStrategy cache logic", () => {
  // These tests exercise the ISRStrategy directly by pre-populating the
  // response cache and calling render(). Since we can't run real SSR here,
  // we only test the cache-HIT and cache-STALE paths. The MISS path
  // delegates to SSRStrategy.render() → renderPage() which requires a
  // React runtime and is covered by integration tests.

  test("cache HIT: returns cached HTML with cacheStatus=HIT", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/posts", {
      html: "<html>cached</html>",
      headers: {},
      statusCode: 200,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: ["posts"],
    });

    const result = await strategy.render(makeISRCtx("/posts"));
    expect(result.cacheStatus).toBe("HIT");
    expect(result.html).toBe("<html>cached</html>");
    expect(result.statusCode).toBe(200);
  });

  test("cache STALE: returns stale HTML with cacheStatus=STALE", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/posts", {
      html: "<html>stale</html>",
      headers: {},
      statusCode: 200,
      createdAt: now - 120_000,
      revalidateAfter: now - 1,
      tags: ["posts"],
    });

    const result = await strategy.render(makeISRCtx("/posts"));
    expect(result.cacheStatus).toBe("STALE");
    expect(result.html).toBe("<html>stale</html>");
  });

  test("cache HIT preserves non-200 statusCode", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/err", {
      html: "<html>not found</html>",
      headers: {},
      statusCode: 404,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: [],
    });

    const result = await strategy.render(makeISRCtx("/err"));
    expect(result.statusCode).toBe(404);
    expect(result.cacheStatus).toBe("HIT");
  });

  test("cache HIT sets loaderData to null (no re-execution)", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/data", {
      html: "<html>data</html>",
      headers: {},
      statusCode: 200,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: [],
    });

    const result = await strategy.render(makeISRCtx("/data"));
    expect(result.loaderData).toBeNull();
  });

  test("cache STALE: background revalidation errors are logged", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    // Force the internal SSR strategy to throw during background revalidation
    (strategy as unknown as { ssr: { render: () => never } }).ssr = {
      render: () => {
        throw new Error("Simulated render failure");
      },
    };

    await responseCacheSet("page:/fail", {
      html: "<html>stale</html>",
      headers: {},
      statusCode: 200,
      createdAt: now - 120_000,
      revalidateAfter: now - 1,
      tags: [],
    });

    const spy = spyOn(console, "error").mockImplementation(() => {});

    const result = await strategy.render(makeISRCtx("/fail"));
    expect(result.cacheStatus).toBe("STALE");

    // Wait for the fire-and-forget revalidation to settle
    await new Promise((r) => setTimeout(r, 50));

    const errorCall = spy.mock.calls.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("ISR background revalidation failed"),
    );
    expect(errorCall).toBeDefined();

    spy.mockRestore();
  });

  test("different URLs use different cache keys", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/a", {
      html: "page-a",
      headers: {},
      statusCode: 200,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: [],
    });

    await responseCacheSet("page:/b", {
      html: "page-b",
      headers: {},
      statusCode: 200,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: [],
    });

    const a = await strategy.render(makeISRCtx("/a"));
    const b = await strategy.render(makeISRCtx("/b"));

    expect(a.html).toBe("page-a");
    expect(b.html).toBe("page-b");
  });
});

// ---------------------------------------------------------------------------
// SSGStrategy
// ---------------------------------------------------------------------------

describe("SSGStrategy", () => {
  test("currently delegates to SSR (Phase 3 stub)", () => {
    const strategy = new SSGStrategy();
    // SSGStrategy should exist and have a render method
    expect(typeof strategy.render).toBe("function");
  });
});
