import { describe, it, expect, mock } from "bun:test";
import { createElement, Suspense } from "react";
import { renderToString, renderToReadableStream } from "react-dom/server";
import {
  // use() hook
  useLoaderDataSuspense,
  PageContext,
  // useActionState wrapper
  useCapstanAction,
  ActionForm,
  // useOptimistic wrapper
  useCapstanOptimistic,
  // React 19 preload APIs
  preloadFont,
  preloadImage,
  // Metadata (hoisting-aware)
  generateMetadataElements,
  // SSR streaming
  renderPageStream,
  renderPage,
} from "@zauso-ai/capstan-react";
import type {
  CapstanPageContext,
  RenderPageOptions,
  FontConfig,
  ImagePreloadOptions,
} from "@zauso-ai/capstan-react";

// ---------------------------------------------------------------------------
// Helper: collect a ReadableStream into a string
// ---------------------------------------------------------------------------

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
// 1. use() hook via useLoaderDataSuspense
// ---------------------------------------------------------------------------

describe("useLoaderDataSuspense (React 19 use() hook)", () => {
  it("resolves a promise and renders the value", async () => {
    const dataPromise = Promise.resolve({ name: "Alice" });

    function UserDisplay({ promise }: { promise: Promise<{ name: string }> }) {
      const data = useLoaderDataSuspense(promise);
      return createElement("span", null, data.name);
    }

    // React 19's renderToReadableStream handles Suspense natively
    const stream = await renderToReadableStream(
      createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading...") },
        createElement(UserDisplay, { promise: dataPromise }),
      ),
    );

    const html = await streamToString(stream);
    expect(html).toContain("Alice");
  });

  it("is exported from the package", () => {
    expect(typeof useLoaderDataSuspense).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 2. useCapstanAction (React 19 useActionState wrapper)
// ---------------------------------------------------------------------------

describe("useCapstanAction (React 19 useActionState)", () => {
  it("is exported and is a function", () => {
    expect(typeof useCapstanAction).toBe("function");
  });

  it("renders a form with initial state", () => {
    function TestForm() {
      const { state, isPending } = useCapstanAction(
        async (prev: { count: number }, _formData: FormData) => ({
          count: prev.count + 1,
        }),
        { count: 0 },
      );

      return createElement(
        "div",
        null,
        createElement("span", { "data-testid": "count" }, String(state.count)),
        createElement("span", { "data-testid": "pending" }, String(isPending)),
      );
    }

    const html = renderToString(createElement(TestForm));
    // Initial state should have count=0
    expect(html).toContain("0");
    // Should not be pending initially
    expect(html).toContain("false");
  });
});

// ---------------------------------------------------------------------------
// 3. useCapstanOptimistic (React 19 useOptimistic)
// ---------------------------------------------------------------------------

describe("useCapstanOptimistic (React 19 useOptimistic)", () => {
  it("is exported and is a function", () => {
    expect(typeof useCapstanOptimistic).toBe("function");
  });

  it("renders with current state when no optimistic update is applied", () => {
    const todos = [{ id: "1", text: "Buy milk" }];

    function TodoList() {
      const [optimisticTodos] = useCapstanOptimistic(
        todos,
        (state: typeof todos, newTodo: (typeof todos)[0]) => [...state, newTodo],
      );

      return createElement(
        "ul",
        null,
        ...optimisticTodos.map((todo) =>
          createElement("li", { key: todo.id }, todo.text),
        ),
      );
    }

    const html = renderToString(createElement(TodoList));
    expect(html).toContain("Buy milk");
  });
});

// ---------------------------------------------------------------------------
// 4. React 19 preload APIs (font + image)
// ---------------------------------------------------------------------------

describe("preloadFont (React 19 resource preloading)", () => {
  it("is exported and is a function", () => {
    expect(typeof preloadFont).toBe("function");
  });

  it("does not throw for a valid font config", () => {
    const config: FontConfig = {
      family: "Inter",
      src: "/fonts/inter.woff2",
      weight: "400",
    };

    expect(() => preloadFont(config)).not.toThrow();
  });

  it("is a no-op when src is empty", () => {
    const config: FontConfig = { family: "Inter" };
    // Should not throw
    expect(() => preloadFont(config)).not.toThrow();
  });

  it("is a no-op when preload is false", () => {
    const config: FontConfig = {
      family: "Inter",
      src: "/fonts/inter.woff2",
      preload: false,
    };
    expect(() => preloadFont(config)).not.toThrow();
  });
});

describe("preloadImage (React 19 resource preloading)", () => {
  it("is exported and is a function", () => {
    expect(typeof preloadImage).toBe("function");
  });

  it("does not throw for a valid image config", () => {
    const options: ImagePreloadOptions = {
      src: "/images/hero.jpg",
      width: 1200,
      priority: true,
    };

    expect(() => preloadImage(options)).not.toThrow();
  });

  it("is a no-op when src is empty", () => {
    const options: ImagePreloadOptions = { src: "" };
    expect(() => preloadImage(options)).not.toThrow();
  });

  it("is a no-op when priority is false and preload is false", () => {
    const options: ImagePreloadOptions = {
      src: "/images/hero.jpg",
      priority: false,
      preload: false,
    };
    expect(() => preloadImage(options)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Metadata hoisting (React 19 document metadata)
// ---------------------------------------------------------------------------

describe("generateMetadataElements (React 19 metadata hoisting)", () => {
  it("generates title element that React 19 hoists to <head>", () => {
    const elements = generateMetadataElements({
      title: "My Page",
      description: "A test page",
    });

    // Should produce <title> and <meta name="description">
    expect(elements.length).toBeGreaterThanOrEqual(2);

    const html = renderToString(
      createElement("div", null, ...elements),
    );
    // React 19 hoists these in real rendering; in renderToString they appear inline
    expect(html).toContain("My Page");
    expect(html).toContain("A test page");
  });

  it("generates OpenGraph meta tags", () => {
    const elements = generateMetadataElements({
      title: "OG Page",
      openGraph: {
        title: "OG Title",
        description: "OG Description",
        type: "website",
      },
    });

    const html = renderToString(
      createElement("div", null, ...elements),
    );
    expect(html).toContain("og:title");
    expect(html).toContain("OG Title");
  });
});

// ---------------------------------------------------------------------------
// 6. Improved SSR streaming (React 19 signal + onError)
// ---------------------------------------------------------------------------

describe("renderPageStream (React 19 SSR improvements)", () => {
  const makeLoaderArgs = () => ({
    params: {},
    request: new Request("http://localhost/"),
    ctx: {
      auth: {
        isAuthenticated: false as const,
        type: "anonymous" as const,
      },
    },
    fetch: {
      get: async () => null as unknown,
      post: async () => null as unknown,
      put: async () => null as unknown,
      delete: async () => null as unknown,
    },
  });

  it("accepts onSSRError callback", async () => {
    const errors: unknown[] = [];

    function Page() {
      return createElement("div", null, "Hello SSR");
    }

    const options: RenderPageOptions = {
      pageModule: { default: Page },
      layouts: [],
      params: {},
      request: new Request("http://localhost/"),
      loaderArgs: makeLoaderArgs(),
      onSSRError: (error) => {
        errors.push(error);
      },
    };

    const result = await renderPageStream(options);
    const html = await streamToString(result.stream);

    expect(html).toContain("Hello SSR");
    expect(result.statusCode).toBe(200);
    // No errors for a simple render
    expect(errors.length).toBe(0);
  });

  it("accepts signal for abort support", async () => {
    const controller = new AbortController();

    function Page() {
      return createElement("div", null, "Abortable render");
    }

    const options: RenderPageOptions = {
      pageModule: { default: Page },
      layouts: [],
      params: {},
      request: new Request("http://localhost/"),
      loaderArgs: makeLoaderArgs(),
      signal: controller.signal,
    };

    const result = await renderPageStream(options);
    const html = await streamToString(result.stream);

    expect(html).toContain("Abortable render");
    expect(result.statusCode).toBe(200);
  });

  it("renders correctly without signal or onSSRError (backward compat)", async () => {
    function Page() {
      return createElement("div", null, "No signal page");
    }

    const options: RenderPageOptions = {
      pageModule: { default: Page },
      layouts: [],
      params: {},
      request: new Request("http://localhost/"),
      loaderArgs: makeLoaderArgs(),
    };

    const result = await renderPageStream(options);
    const html = await streamToString(result.stream);

    expect(html).toContain("No signal page");
  });
});

// ---------------------------------------------------------------------------
// 7. ActionForm still works (backward compatibility)
// ---------------------------------------------------------------------------

describe("ActionForm (backward compatibility)", () => {
  it("renders a form with hidden _capstan_action field", () => {
    const html = renderToString(
      createElement(ActionForm, { action: "/api/submit" },
        createElement("button", { type: "submit" }, "Submit"),
      ),
    );

    expect(html).toContain("method=\"post\"");
    expect(html).toContain("_capstan_action");
    expect(html).toContain("Submit");
  });
});

// ---------------------------------------------------------------------------
// 8. Ref cleanup functions (React 19 documentation)
// ---------------------------------------------------------------------------

describe("React 19 ref cleanup pattern", () => {
  it("ref cleanup functions are supported in React 19", () => {
    // React 19 supports returning a cleanup function from ref callbacks,
    // similar to useEffect. This test verifies the pattern works.
    let cleanedUp = false;

    function Component() {
      return createElement("div", {
        ref: (node: HTMLDivElement | null) => {
          if (node) {
            // Setup: node is mounted
            return () => {
              // Cleanup: node is unmounted (React 19 feature)
              cleanedUp = true;
            };
          }
        },
      }, "Ref cleanup test");
    }

    // renderToString doesn't execute refs, but the pattern should not throw
    const html = renderToString(createElement(Component));
    expect(html).toContain("Ref cleanup test");
  });
});

// ---------------------------------------------------------------------------
// Export verification
// ---------------------------------------------------------------------------

describe("React 19 feature exports", () => {
  it("exports useLoaderDataSuspense", () => {
    expect(typeof useLoaderDataSuspense).toBe("function");
  });

  it("exports useCapstanAction", () => {
    expect(typeof useCapstanAction).toBe("function");
  });

  it("exports useCapstanOptimistic", () => {
    expect(typeof useCapstanOptimistic).toBe("function");
  });

  it("exports preloadFont", () => {
    expect(typeof preloadFont).toBe("function");
  });

  it("exports preloadImage", () => {
    expect(typeof preloadImage).toBe("function");
  });
});
