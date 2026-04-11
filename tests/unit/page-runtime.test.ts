import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createElement } from "react";
import { Outlet } from "@zauso-ai/capstan-react";
import {
  MemoryStore,
  responseCacheClear,
  responseCacheSet,
  setResponseCacheStore,
} from "@zauso-ai/capstan-core";
import type { ResponseCacheEntry } from "@zauso-ai/capstan-core";
import type { LayoutModule, LoaderArgs, PageModule } from "@zauso-ai/capstan-react";
import { runPageRuntime } from "../../packages/dev/src/page-runtime.js";

function makeLoaderArgs(): LoaderArgs {
  return {
    params: {},
    request: new Request("http://localhost/"),
    ctx: {
      auth: {
        isAuthenticated: false,
        type: "anonymous",
      },
    },
    fetch: {
      get: async () => null,
      post: async () => null,
      put: async () => null,
      delete: async () => null,
    },
  };
}

function makePageModule(overrides?: Partial<PageModule> & { metadata?: unknown }): PageModule & { metadata?: unknown } {
  return {
    default: () => createElement("main", null, "Hello from runtime"),
    ...overrides,
  };
}

function makeLayout(label: string): LayoutModule {
  return {
    default: ({ children }) =>
      createElement(
        "section",
        { "data-layout": label },
        createElement("header", null, label),
        children ?? null,
        createElement(Outlet, null),
      ),
  };
}

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

beforeEach(async () => {
  await responseCacheClear();
  setResponseCacheStore(new MemoryStore<ResponseCacheEntry>());
});

describe("runPageRuntime", () => {
  it("returns a navigation payload with rendered HTML for server components", async () => {
    const pageModule = makePageModule({
      loader: async () => ({ ticketCount: 3 }),
      metadata: { title: "Tickets", description: "Runtime" },
    });
    const request = new Request("http://localhost/tickets/123?tab=activity", {
      headers: { "X-Capstan-Nav": "1" },
    });

    const result = await runPageRuntime({
      pageModule,
      layouts: [makeLayout("root"), makeLayout("tickets")],
      layoutKeys: ["/_layout.tsx", "/tickets/_layout.tsx"],
      params: { id: "123" },
      request,
      loaderArgs: { ...makeLoaderArgs(), request },
    });

    expect(result.kind).toBe("navigation");
    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toContain("application/json");
    expect(result.url).toBe("/tickets/123");

    if (result.kind !== "navigation") throw new Error("Expected navigation result");
    expect(result.payload.url).toBe("/tickets/123");
    expect(result.payload.layoutKey).toBe("/tickets/_layout.tsx");
    expect(result.payload.componentType).toBe("server");
    expect(result.payload.metadata).toEqual({ title: "Tickets", description: "Runtime" });
    expect(result.payload.html).toContain("Hello from runtime");
    expect(result.payload.html).toContain("data-layout");
    expect(result.loaderData).toEqual({ ticketCount: 3 });

    const parsed = JSON.parse(result.body) as Record<string, unknown>;
    expect(parsed.url).toBe("/tickets/123");
    expect(parsed.componentType).toBe("server");
  });

  it("returns a navigation payload without HTML for client components", async () => {
    const pageModule = makePageModule({
      componentType: "client",
      loader: async () => ({ ready: true }),
      metadata: { title: "Client Page" },
    });
    const request = new Request("http://localhost/client-view", {
      headers: { "X-Capstan-Nav": "1" },
    });

    const result = await runPageRuntime({
      pageModule,
      layouts: [],
      params: {},
      request,
      loaderArgs: { ...makeLoaderArgs(), request },
    });

    expect(result.kind).toBe("navigation");
    expect(result.headers["cache-control"]).toBe("no-store");

    if (result.kind !== "navigation") throw new Error("Expected navigation result");
    expect(result.payload.componentType).toBe("client");
    expect(result.payload.html).toBeUndefined();
    expect(result.loaderData).toEqual({ ready: true });

    const parsed = JSON.parse(result.body) as Record<string, unknown>;
    expect(parsed.html).toBeUndefined();
    expect(parsed.loaderData).toEqual({ ready: true });
  });

  it("merges layout metadata into full document renders and injects resolved head tags", async () => {
    const request = new Request("http://localhost/billing");

    const result = await runPageRuntime({
      pageModule: makePageModule({
        metadata: {
          title: "Billing",
          keywords: ["agents", "billing"],
          openGraph: {
            siteName: "Capstan",
          },
        },
      }),
      layouts: [],
      metadataChain: [
        {
          title: { default: "Workspace", template: "%s | Capstan" },
          canonical: "https://example.com/billing",
        },
        {
          description: "Shared billing controls",
          robots: { index: false, follow: true },
        },
      ],
      params: {},
      request,
      loaderArgs: { ...makeLoaderArgs(), request },
    });

    expect(result.kind).toBe("document");
    if (result.kind !== "document" || result.transport !== "html") {
      throw new Error("Expected html document result");
    }

    expect(result.metadata).toEqual({
      title: "Billing | Capstan",
      description: "Shared billing controls",
      canonical: "https://example.com/billing",
      keywords: ["agents", "billing"],
      robots: { index: false, follow: true },
      openGraph: {
        siteName: "Capstan",
      },
    });
    expect(result.html).toContain("<title>Billing | Capstan</title>");
    expect(result.html).toContain('name="description" content="Shared billing controls"');
    expect(result.html).toContain('rel="canonical" href="https://example.com/billing"');
    expect(result.html).toContain('name="robots" content="noindex, follow"');
    expect(result.html).toContain('property="og:title" content="Billing | Capstan"');
    expect(result.html).toContain('property="og:site_name" content="Capstan"');
  });

  it("honors explicit statusCode overrides for document and navigation results", async () => {
    const documentRequest = new Request("http://localhost/missing");
    const documentResult = await runPageRuntime({
      pageModule: makePageModule(),
      layouts: [],
      params: {},
      request: documentRequest,
      loaderArgs: { ...makeLoaderArgs(), request: documentRequest },
      statusCode: 404,
    });

    expect(documentResult.kind).toBe("document");
    expect(documentResult.statusCode).toBe(404);

    const navigationRequest = new Request("http://localhost/missing", {
      headers: { "X-Capstan-Nav": "1" },
    });
    const navigationResult = await runPageRuntime({
      pageModule: makePageModule(),
      layouts: [],
      params: {},
      request: navigationRequest,
      loaderArgs: { ...makeLoaderArgs(), request: navigationRequest },
      statusCode: 404,
    });

    expect(navigationResult.kind).toBe("navigation");
    expect(navigationResult.statusCode).toBe(404);
  });

  it("applies the SSG strategy for full-page html responses", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "page-runtime-ssg-"));
    try {
      const staticDir = join(tempDir, "static");
      await mkdir(staticDir, { recursive: true });
      await writeFile(join(staticDir, "index.html"), "<html>static hit</html>", "utf-8");

      const pageModule = makePageModule({
        renderMode: "ssg",
        default: () => {
          throw new Error("the SSG strategy should not render the component");
        },
      });
      const request = new Request("http://localhost/");

      const result = await runPageRuntime({
        pageModule,
        layouts: [],
        params: {},
        request,
        loaderArgs: { ...makeLoaderArgs(), request },
        strategyOptions: { staticDir },
      });

      expect(result.kind).toBe("document");
      expect(result.statusCode).toBe(200);
      expect(result.headers["content-type"]).toBe("text/html; charset=utf-8");

      if (result.kind !== "document" || result.transport !== "html") {
        throw new Error("Expected html document result");
      }
      expect(result.cacheStatus).toBe("HIT");
      expect(result.body).toBe("<html>static hit</html>");
      expect(result.html).toBe("<html>static hit</html>");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("applies the ISR strategy and preserves cache hits", async () => {
    const now = Date.now();
    await responseCacheSet("page:/cached", {
      html: "<html>cached page</html>",
      headers: {},
      statusCode: 418,
      createdAt: now,
      revalidateAfter: now + 60_000,
      tags: ["cached"],
    });

    const pageModule = makePageModule({
      renderMode: "isr",
      default: () => {
        throw new Error("the ISR cache hit should not render the component");
      },
    });
    const request = new Request("http://localhost/cached?foo=bar");

    const result = await runPageRuntime({
      pageModule,
      layouts: [],
      params: {},
      request,
      loaderArgs: { ...makeLoaderArgs(), request },
    });

    expect(result.kind).toBe("document");
    if (result.kind !== "document" || result.transport !== "html") {
      throw new Error("Expected html document result");
    }
    expect(result.cacheStatus).toBe("HIT");
    expect(result.statusCode).toBe(418);
    expect(result.body).toBe("<html>cached page</html>");
  });

  it("passes a normalized request pathname to the strategy layer", async () => {
    const request = new Request("http://localhost/projects/alpha?draft=1#section");
    let capturedUrl = "";
    let capturedTags: unknown;
    let capturedRevalidate: unknown;

    const result = await runPageRuntime({
      pageModule: makePageModule({
        renderMode: "isr",
        revalidate: 30,
        cacheTags: ["projects", " alpha "],
      }),
      layouts: [],
      params: {},
      request,
      loaderArgs: { ...makeLoaderArgs(), request },
      strategyFactory: () => ({
        render: async (ctx) => {
          capturedUrl = ctx.url;
          capturedTags = ctx.cacheTags;
          capturedRevalidate = ctx.revalidate;
          return {
            html: "<html>normalized runtime</html>",
            loaderData: null,
            statusCode: 200,
            cacheStatus: "HIT",
          };
        },
      }),
    });

    expect(capturedUrl).toBe("/projects/alpha");
    expect(capturedTags).toEqual(["projects", " alpha "]);
    expect(capturedRevalidate).toBe(30);
    expect(result.kind).toBe("document");
    expect(result.url).toBe("/projects/alpha");
  });

  it("uses the normalized pathname for SSG file resolution even with query strings", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "page-runtime-ssg-query-"));
    try {
      const staticDir = join(tempDir, "static");
      await mkdir(join(staticDir, "docs"), { recursive: true });
      await writeFile(join(staticDir, "docs", "index.html"), "<html>docs static</html>", "utf-8");

      const request = new Request("http://localhost/docs?lang=zh#overview");
      const result = await runPageRuntime({
        pageModule: makePageModule({
          renderMode: "ssg",
          default: () => {
            throw new Error("the SSG cache hit should not render the component");
          },
        }),
        layouts: [],
        params: {},
        request,
        loaderArgs: { ...makeLoaderArgs(), request },
        strategyOptions: { staticDir },
      });

      expect(result.kind).toBe("document");
      if (result.kind !== "document" || result.transport !== "html") {
        throw new Error("Expected html document result");
      }
      expect(result.url).toBe("/docs");
      expect(result.cacheStatus).toBe("HIT");
      expect(result.body).toBe("<html>docs static</html>");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("wraps cached html in a stream when SSG or ISR pages request stream transport", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "page-runtime-stream-cache-"));
    try {
      const staticDir = join(tempDir, "static");
      await mkdir(staticDir, { recursive: true });
      await writeFile(join(staticDir, "index.html"), "<html>streamed static</html>", "utf-8");

      const ssgRequest = new Request("http://localhost/");
      const ssgResult = await runPageRuntime({
        pageModule: makePageModule({
          renderMode: "ssg",
          metadata: { title: 123 },
        }),
        layouts: [],
        params: {},
        request: ssgRequest,
        loaderArgs: { ...makeLoaderArgs(), request: ssgRequest },
        transport: "stream",
        strategyOptions: { staticDir },
      });

      expect(ssgResult.kind).toBe("document");
      if (ssgResult.kind !== "document" || ssgResult.transport !== "stream") {
        throw new Error("Expected stream document result");
      }
      expect(await streamToText(ssgResult.stream)).toBe("<html>streamed static</html>");
      expect(ssgResult.metadata).toBeUndefined();

      const now = Date.now();
      await responseCacheSet("page:/cached-stream", {
        html: "<html>cached stream</html>",
        headers: {},
        statusCode: 202,
        createdAt: now,
        revalidateAfter: now + 60_000,
        tags: ["cached-stream"],
      });

      const isrRequest = new Request("http://localhost/cached-stream");
      const isrResult = await runPageRuntime({
        pageModule: makePageModule({
          renderMode: "isr",
        }),
        layouts: [],
        params: {},
        request: isrRequest,
        loaderArgs: { ...makeLoaderArgs(), request: isrRequest },
        transport: "stream",
      });

      expect(isrResult.kind).toBe("document");
      if (isrResult.kind !== "document" || isrResult.transport !== "stream") {
        throw new Error("Expected stream document result");
      }
      expect(isrResult.statusCode).toBe(202);
      expect(isrResult.cacheStatus).toBe("HIT");
      expect(await streamToText(isrResult.stream)).toBe("<html>cached stream</html>");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns a stream for streamed full-page renders", async () => {
    const pageModule = makePageModule({
      componentType: "client",
      hydration: "visible",
      loader: async () => ({ message: "streamed" }),
    });
    const request = new Request("http://localhost/streamed");

    const result = await runPageRuntime({
      pageModule,
      layouts: [],
      params: {},
      request,
      loaderArgs: { ...makeLoaderArgs(), request },
      transport: "stream",
    });

    expect(result.kind).toBe("document");
    if (result.kind !== "document" || result.transport !== "stream") {
      throw new Error("Expected stream document result");
    }
    expect(result.statusCode).toBe(200);
    expect(result.stream).toBeInstanceOf(ReadableStream);
    expect(result.allReady).toBeInstanceOf(Promise);

    const html = await streamToText(result.stream);
    expect(html).toContain("Hello from runtime");
    expect(html).toContain("IntersectionObserver");
    expect(html).toContain("__CAPSTAN_DATA__");
  });

  it("defaults unknown render modes to SSR rather than throwing", async () => {
    const pageModule = makePageModule({
      renderMode: "bogus" as never,
      metadata: { title: "Fallback" },
    });
    const request = new Request("http://localhost/fallback");

    const result = await runPageRuntime({
      pageModule,
      layouts: [],
      params: {},
      request,
      loaderArgs: { ...makeLoaderArgs(), request },
    });

    expect(result.kind).toBe("document");
    if (result.kind !== "document" || result.transport !== "html") {
      throw new Error("Expected html document result");
    }
    expect(result.body).toContain("Hello from runtime");
    expect(result.metadata).toEqual({ title: "Fallback" });
  });

  it("throws when the page module has no default export", async () => {
    const request = new Request("http://localhost/broken");

    await expect(
      runPageRuntime({
        pageModule: {} as PageModule & { metadata?: unknown },
        layouts: [],
        params: {},
        request,
        loaderArgs: { ...makeLoaderArgs(), request },
      }),
    ).rejects.toThrow("default React component");
  });
});
