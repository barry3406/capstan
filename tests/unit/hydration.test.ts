import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderPage, renderPageStream, ServerOnly } from "@zauso-ai/capstan-react";
import type {
  PageModule,
  RenderPageOptions,
  LoaderArgs,
} from "@zauso-ai/capstan-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal LoaderArgs for testing. */
function makeLoaderArgs(
  overrides?: Partial<LoaderArgs>,
): LoaderArgs {
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
      get: async () => null as unknown,
      post: async () => null as unknown,
      put: async () => null as unknown,
      delete: async () => null as unknown,
    },
    ...overrides,
  };
}

/** Build a minimal PageModule that renders a simple component. */
function makePageModule(
  overrides?: Partial<PageModule>,
): PageModule {
  return {
    default: () => createElement("div", null, "Hello Page"),
    ...overrides,
  };
}

/** Build RenderPageOptions with sensible defaults. */
function makeRenderOptions(
  overrides?: Partial<RenderPageOptions>,
): RenderPageOptions {
  const loaderArgs = makeLoaderArgs();
  return {
    pageModule: makePageModule(),
    layouts: [],
    params: {},
    request: new Request("http://localhost/"),
    loaderArgs,
    ...overrides,
  };
}

/**
 * Collect a ReadableStream into a string.
 */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

// ---------------------------------------------------------------------------
// renderPage / renderPageStream — hydration modes
// ---------------------------------------------------------------------------

describe("renderPage hydration modes", () => {
  it("default (no option) includes bootstrapModules and data script", async () => {
    const result = await renderPage(makeRenderOptions());
    // "full" mode injects __CAPSTAN_DATA__ and the client bootstrap module
    expect(result.html).toContain("__CAPSTAN_DATA__");
    expect(result.html).toContain("/_capstan/client.js");
  });

  it('hydration: "full" includes bootstrapModules and data script', async () => {
    const result = await renderPage(
      makeRenderOptions({ hydration: "full" }),
    );
    expect(result.html).toContain("__CAPSTAN_DATA__");
    expect(result.html).toContain("/_capstan/client.js");
  });

  it('hydration: "none" does not include bootstrap scripts or data script', async () => {
    const result = await renderPage(
      makeRenderOptions({ hydration: "none" }),
    );
    expect(result.html).not.toContain("__CAPSTAN_DATA__");
    expect(result.html).not.toContain("/_capstan/client.js");
    expect(result.html).not.toContain("IntersectionObserver");
  });

  it('hydration: "visible" includes IntersectionObserver script', async () => {
    const result = await renderPage(
      makeRenderOptions({ hydration: "visible" }),
    );
    expect(result.html).toContain("IntersectionObserver");
    expect(result.html).toContain("__CAPSTAN_DATA__");
    expect(result.html).toContain("/_capstan/client.js");
  });

  it('hydration: "visible" does not use bootstrapModules (uses inline import)', async () => {
    const result = await renderPage(
      makeRenderOptions({ hydration: "visible" }),
    );
    // In "visible" mode the client import is triggered via IntersectionObserver,
    // not via React's bootstrapModules mechanism. The client.js URL appears
    // inside the inline script but not as a separate module script tag.
    expect(result.html).toContain("import('/_capstan/client.js')");
  });

  it("page module export hydration: 'none' is respected", async () => {
    const pageModule = makePageModule({ hydration: "none" });
    const result = await renderPage(
      makeRenderOptions({ pageModule }),
    );
    expect(result.html).not.toContain("__CAPSTAN_DATA__");
    expect(result.html).not.toContain("/_capstan/client.js");
  });

  it("explicit option overrides page module export", async () => {
    const pageModule = makePageModule({ hydration: "none" });
    const result = await renderPage(
      makeRenderOptions({ pageModule, hydration: "full" }),
    );
    // The explicit "full" option should win over the module's "none"
    expect(result.html).toContain("__CAPSTAN_DATA__");
    expect(result.html).toContain("/_capstan/client.js");
  });

  it('componentType: "server" produces no hydration scripts at all', async () => {
    const result = await renderPage(
      makeRenderOptions({ componentType: "server" }),
    );
    expect(result.html).not.toContain("__CAPSTAN_DATA__");
    expect(result.html).not.toContain("/_capstan/client.js");
    expect(result.html).not.toContain("IntersectionObserver");
    expect(result.html).not.toContain("<script");
  });

  it('componentType: "server" from page module produces no hydration scripts', async () => {
    const pageModule = makePageModule({ componentType: "server" });
    const result = await renderPage(
      makeRenderOptions({ pageModule }),
    );
    expect(result.html).not.toContain("__CAPSTAN_DATA__");
    expect(result.html).not.toContain("/_capstan/client.js");
    expect(result.html).not.toContain("<script");
  });

  it("server component type takes precedence regardless of hydration mode", async () => {
    // Even if hydration is "full", componentType "server" should suppress all JS
    const result = await renderPage(
      makeRenderOptions({ componentType: "server", hydration: "full" }),
    );
    expect(result.html).not.toContain("__CAPSTAN_DATA__");
    expect(result.html).not.toContain("/_capstan/client.js");
  });

  it("renders the page content in all hydration modes", async () => {
    const pageModule = makePageModule({
      default: () => createElement("h1", null, "My Heading"),
    });

    for (const mode of ["full", "visible", "none"] as const) {
      const result = await renderPage(
        makeRenderOptions({ pageModule, hydration: mode }),
      );
      expect(result.html).toContain("My Heading");
    }
  });

  it("serializes loader data into __CAPSTAN_DATA__ in full mode", async () => {
    const pageModule = makePageModule({
      loader: async () => ({ items: [1, 2, 3] }),
    });
    const result = await renderPage(
      makeRenderOptions({ pageModule, hydration: "full" }),
    );
    expect(result.html).toContain("__CAPSTAN_DATA__");
    // The data should contain the serialized loader output
    expect(result.loaderData).toEqual({ items: [1, 2, 3] });
  });

  it("escapes </script> in loader data to prevent XSS", async () => {
    const pageModule = makePageModule({
      loader: async () => ({
        evil: '</script><script>alert("xss")</script>',
      }),
    });
    const result = await renderPage(
      makeRenderOptions({ pageModule }),
    );
    // The raw </script> must NOT appear unescaped in the HTML output.
    // It should be escaped as \u003c/script\u003e
    expect(result.html).not.toContain("</script><script>");
    expect(result.html).toContain("\\u003c/script\\u003e");
  });

  it("returns statusCode 200", async () => {
    const result = await renderPage(makeRenderOptions());
    expect(result.statusCode).toBe(200);
  });

  it("re-renders with the server error fallback when page rendering throws", async () => {
    const result = await renderPage(
      makeRenderOptions({
        pageModule: makePageModule({
          default: () => {
            throw new Error("server boom");
          },
        }),
        errorComponent: ({ error }) =>
          createElement("div", { "data-error": "root" }, `root error: ${error.message}`),
      }),
    );

    expect(result.html).toContain('data-error="root"');
    expect(result.html).toContain("root error: server boom");
    expect(result.html).not.toContain("Switched to client rendering");
  });
});

// ---------------------------------------------------------------------------
// renderPageStream — streaming SSR
// ---------------------------------------------------------------------------

describe("renderPageStream", () => {
  it("returns a stream, allReady promise, loaderData, and statusCode", async () => {
    const result = await renderPageStream(makeRenderOptions());

    expect(result.stream).toBeInstanceOf(ReadableStream);
    expect(result.allReady).toBeInstanceOf(Promise);
    expect(result.statusCode).toBe(200);

    // Verify loaderData is present (null when no loader defined)
    expect(result.loaderData).toBeNull();

    // Consume the stream to verify it produces valid HTML
    const html = await streamToString(result.stream);
    expect(html).toContain("Hello Page");
  });

  it("includes loader data in the stream result", async () => {
    const pageModule = makePageModule({
      loader: async () => ({ count: 42 }),
    });
    const result = await renderPageStream(
      makeRenderOptions({ pageModule }),
    );

    expect(result.loaderData).toEqual({ count: 42 });
    expect(result.statusCode).toBe(200);

    // The stream should contain the serialized data
    const html = await streamToString(result.stream);
    expect(html).toContain("__CAPSTAN_DATA__");
  });
});

// ---------------------------------------------------------------------------
// hydrateCapstanPage
// ---------------------------------------------------------------------------

describe("hydrateCapstanPage", () => {
  it("skips hydration when window.__CAPSTAN_DATA__ is undefined", async () => {
    // We can't easily test browser-side hydration in a Node/Bun environment
    // because hydrateRoot requires a real DOM. Instead we verify the guard
    // logic by importing the module and checking that calling it with a
    // mock environment where __CAPSTAN_DATA__ is undefined does not throw.
    const { hydrateCapstanPage } = await import(
      "@zauso-ai/capstan-react"
    );

    // Set up a minimal globalThis.window without __CAPSTAN_DATA__
    const origWindow = (globalThis as Record<string, unknown>)["window"];
    (globalThis as Record<string, unknown>)["window"] = {};

    try {
      // Should silently return without calling hydrateRoot (which would throw
      // because there's no real DOM).
      const mockElement = {} as Element;
      const MockComponent = () => createElement("div");
      hydrateCapstanPage(mockElement, MockComponent, [], {
        loaderData: null,
        params: {},
        auth: { isAuthenticated: false, type: "anonymous" },
      });
      // Note: Cannot verify hydrateRoot was not called without a DOM environment.
      // This test only verifies no exception is thrown.
      expect(true).toBe(true);
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as Record<string, unknown>)["window"];
      } else {
        (globalThis as Record<string, unknown>)["window"] = origWindow;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ServerOnly component
// ---------------------------------------------------------------------------

describe("ServerOnly", () => {
  it("renders children through Fragment (produces child content in HTML)", async () => {
    const pageModule = makePageModule({
      default: () =>
        createElement(ServerOnly, null, createElement("p", null, "Secret")),
    });
    const result = await renderPage(
      makeRenderOptions({ pageModule, componentType: "server" }),
    );
    expect(result.html).toContain("Secret");
    expect(result.html).toContain("<p>");
  });

  it("renders with no children (does not crash)", async () => {
    const pageModule = makePageModule({
      default: () => createElement(ServerOnly, null) as ReactElement,
    });
    const result = await renderPage(
      makeRenderOptions({ pageModule, componentType: "server" }),
    );
    // Should render without error — the HTML should still contain the shell
    expect(result.html).toContain("<html");
  });

  it("renders with text children", async () => {
    const pageModule = makePageModule({
      default: () =>
        createElement(ServerOnly, null, "Plain text content"),
    });
    const result = await renderPage(
      makeRenderOptions({ pageModule, componentType: "server" }),
    );
    expect(result.html).toContain("Plain text content");
  });

  it("renders with element children", async () => {
    const pageModule = makePageModule({
      default: () =>
        createElement(
          ServerOnly,
          null,
          createElement("span", { className: "inner" }, "Nested"),
        ),
    });
    const result = await renderPage(
      makeRenderOptions({ pageModule, componentType: "server" }),
    );
    expect(result.html).toContain("Nested");
    expect(result.html).toContain("inner");
  });

  it("renders with null children", async () => {
    const pageModule = makePageModule({
      // React treats null children in a Fragment like an empty render
      default: () =>
        createElement(ServerOnly, { children: null }) as ReactElement,
    });
    const result = await renderPage(
      makeRenderOptions({ pageModule, componentType: "server" }),
    );
    // Should render the shell without crashing
    expect(result.html).toContain("<html");
  });

  it("renders with multiple children", async () => {
    const pageModule = makePageModule({
      default: () =>
        createElement(
          ServerOnly,
          null,
          createElement("h2", null, "Title"),
          createElement("p", null, "Body"),
        ),
    });
    const result = await renderPage(
      makeRenderOptions({ pageModule, componentType: "server" }),
    );
    expect(result.html).toContain("Title");
    expect(result.html).toContain("Body");
  });
});
