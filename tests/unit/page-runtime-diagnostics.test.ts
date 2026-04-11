import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import {
  createPageCacheKey,
  normalizePagePath,
} from "@zauso-ai/capstan-react";
import { runPageRuntime } from "../../packages/dev/src/page-runtime.js";
import type { LayoutModule, LoaderArgs, PageModule } from "@zauso-ai/capstan-react";

function makeLoaderArgs(request: Request): LoaderArgs {
  return {
    params: {},
    request,
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

function makePageModule(): PageModule {
  return {
    default: () => createElement("main", null, "Diagnostics"),
    renderMode: "isr",
  };
}

function makeLayout(): LayoutModule {
  return {
    default: ({ children }) => createElement("section", null, children ?? null),
  };
}

describe("page runtime diagnostics", () => {
  it("normalizes cache paths and exposes diagnostics for render decisions", async () => {
    const request = new Request("http://localhost/notes/list?draft=1#top");
    const result = await runPageRuntime({
      pageModule: makePageModule(),
      layouts: [makeLayout()],
      params: {},
      request,
      loaderArgs: makeLoaderArgs(request),
      strategyFactory: () => ({
        render: async () => ({
          html: "<html><body>cached</body></html>",
          loaderData: { from: "cache" },
          statusCode: 203,
          cacheStatus: "HIT",
        }),
      }),
    });

    expect(normalizePagePath(request.url)).toBe("/notes/list");
    expect(createPageCacheKey(request.url)).toBe("page:/notes/list");
    expect(result.headers["x-capstan-diagnostics"]).toBeDefined();
    expect(result.diagnostics?.some((diag) => diag.code === "page-runtime.request")).toBe(true);
    expect(result.diagnostics?.some((diag) => diag.code === "page-runtime.cache")).toBe(true);
    expect(result.url).toBe("/notes/list");
  });
});
