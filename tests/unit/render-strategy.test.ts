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
  test("has a render method", () => {
    const strategy = new SSGStrategy();
    expect(typeof strategy.render).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ISRStrategy — more edge cases
// ---------------------------------------------------------------------------

describe("ISRStrategy edge cases", () => {
  test("cache key uses page: prefix + URL", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    // Set with key "page:/specific-path"
    await responseCacheSet("page:/specific-path", {
      html: "<html>specific</html>",
      headers: {},
      statusCode: 200,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: [],
    });

    // Should find it with URL /specific-path
    const result = await strategy.render(makeISRCtx("/specific-path"));
    expect(result.cacheStatus).toBe("HIT");
    expect(result.html).toBe("<html>specific</html>");
  });

  test("cache entry with revalidateAfter=null is always fresh", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/static", {
      html: "<html>static forever</html>",
      headers: {},
      statusCode: 200,
      createdAt: now - 999_999_999,
      revalidateAfter: null,
      tags: [],
    });

    const result = await strategy.render(makeISRCtx("/static"));
    expect(result.cacheStatus).toBe("HIT");
    expect(result.html).toBe("<html>static forever</html>");
  });

  test("STALE returns original statusCode not 200", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/stale-error", {
      html: "<html>error page stale</html>",
      headers: {},
      statusCode: 500,
      createdAt: now - 120_000,
      revalidateAfter: now - 1,
      tags: [],
    });

    const result = await strategy.render(makeISRCtx("/stale-error"));
    expect(result.cacheStatus).toBe("STALE");
    expect(result.statusCode).toBe(500);
  });

  test("STALE loaderData is null", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/stale-data", {
      html: "<html>stale data</html>",
      headers: {},
      statusCode: 200,
      createdAt: now - 120_000,
      revalidateAfter: now - 1,
      tags: [],
    });

    const result = await strategy.render(makeISRCtx("/stale-data"));
    expect(result.loaderData).toBeNull();
  });

  test("cache tags are preserved in cache entry", async () => {
    const now = Date.now();
    await responseCacheSet("page:/tagged", {
      html: "<html>tagged</html>",
      headers: {},
      statusCode: 200,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: ["blog", "featured"],
    });

    const entry = await responseCacheGet("page:/tagged");
    expect(entry).toBeDefined();
    expect(entry!.entry.tags).toEqual(["blog", "featured"]);
  });

  test("sequential cache reads for same URL return same content", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/repeat", {
      html: "<html>repeat</html>",
      headers: {},
      statusCode: 200,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: [],
    });

    const r1 = await strategy.render(makeISRCtx("/repeat"));
    const r2 = await strategy.render(makeISRCtx("/repeat"));
    expect(r1.html).toBe(r2.html);
    expect(r1.cacheStatus).toBe("HIT");
    expect(r2.cacheStatus).toBe("HIT");
  });

  test("different cacheTags in ctx don't affect cache lookup", async () => {
    const strategy = new ISRStrategy();
    const now = Date.now();

    await responseCacheSet("page:/tags", {
      html: "<html>tag test</html>",
      headers: {},
      statusCode: 200,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: ["original"],
    });

    // ctx has different cacheTags — but lookup is by key, not tags
    const ctx = makeISRCtx("/tags");
    ctx.cacheTags = ["different"];
    const result = await strategy.render(ctx);
    expect(result.cacheStatus).toBe("HIT");
  });
});

// ---------------------------------------------------------------------------
// SSRStrategy
// ---------------------------------------------------------------------------

describe("SSRStrategy", () => {
  test("has a render method", () => {
    const strategy = new SSRStrategy();
    expect(typeof strategy.render).toBe("function");
  });

  test("is the default for createStrategy('ssr')", () => {
    expect(createStrategy("ssr")).toBeInstanceOf(SSRStrategy);
  });

  test("is used as fallback for unknown modes", () => {
    expect(createStrategy("nonexistent" as never)).toBeInstanceOf(SSRStrategy);
  });
});

// ---------------------------------------------------------------------------
// createStrategy — additional tests
// ---------------------------------------------------------------------------

describe("createStrategy edge cases", () => {
  test("ssg with staticDir option", () => {
    const strategy = createStrategy("ssg", { staticDir: "/custom/path" });
    expect(strategy).toBeInstanceOf(SSGStrategy);
  });

  test("non-ssg modes ignore staticDir", () => {
    const strategy = createStrategy("ssr", { staticDir: "/custom/path" });
    expect(strategy).toBeInstanceOf(SSRStrategy);
  });

  test("isr ignores staticDir", () => {
    const strategy = createStrategy("isr", { staticDir: "/custom/path" });
    expect(strategy).toBeInstanceOf(ISRStrategy);
  });
});
