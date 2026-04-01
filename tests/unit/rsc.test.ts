import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ServerOnly, ClientOnly, serverOnly } from "@zauso-ai/capstan-react";

// ---------------------------------------------------------------------------
// ServerOnly
// ---------------------------------------------------------------------------

describe("ServerOnly", () => {
  it("renders children in SSR", () => {
    const html = renderToString(
      createElement(ServerOnly, null, createElement("p", null, "secret")),
    );
    expect(html).toContain("secret");
  });

  it("outputs <capstan-server data-ssr> wrapper", () => {
    const html = renderToString(
      createElement(ServerOnly, null, createElement("span", null, "hi")),
    );
    expect(html).toContain("<capstan-server");
    expect(html).toContain('data-ssr=""');
  });

  it("renders empty tag when no children", () => {
    const html = renderToString(createElement(ServerOnly, null));
    expect(html).toContain("<capstan-server");
    // Should not contain any child text
    expect(html).not.toContain("undefined");
  });

  it("renders string children", () => {
    const html = renderToString(
      createElement(ServerOnly, null, "plain text"),
    );
    expect(html).toContain("plain text");
  });

  it("renders multiple children", () => {
    const html = renderToString(
      createElement(
        ServerOnly,
        null,
        createElement("span", null, "first"),
        createElement("span", null, "second"),
      ),
    );
    expect(html).toContain("first");
    expect(html).toContain("second");
  });

  it("multiple ServerOnly blocks render independently", () => {
    const html = renderToString(
      createElement(
        "div",
        null,
        createElement(ServerOnly, null, "block-a"),
        createElement(ServerOnly, null, "block-b"),
      ),
    );
    expect(html).toContain("block-a");
    expect(html).toContain("block-b");
    // Two separate capstan-server elements
    const matches = html.match(/<capstan-server/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("renders nested React elements as children", () => {
    const html = renderToString(
      createElement(
        ServerOnly,
        null,
        createElement("div", { className: "wrapper" },
          createElement("strong", null, "deep"),
        ),
      ),
    );
    expect(html).toContain("<strong>deep</strong>");
    expect(html).toContain('class="wrapper"');
  });
});

// ---------------------------------------------------------------------------
// ClientOnly
// ---------------------------------------------------------------------------

describe("ClientOnly", () => {
  it("renders fallback in SSR", () => {
    const html = renderToString(
      createElement(ClientOnly, {
        fallback: createElement("span", null, "loading..."),
        children: createElement("span", null, "client content"),
      }),
    );
    expect(html).toContain("loading...");
    expect(html).not.toContain("client content");
  });

  it("renders nothing when no fallback", () => {
    const html = renderToString(
      createElement(ClientOnly, {
        children: createElement("span", null, "client only"),
      }),
    );
    expect(html).toContain("<capstan-client>");
    expect(html).not.toContain("client only");
  });

  it("outputs <capstan-client> wrapper", () => {
    const html = renderToString(createElement(ClientOnly, null));
    expect(html).toContain("<capstan-client>");
  });

  it("fallback can be a React element", () => {
    const fallback = createElement("div", { className: "skeleton" }, "Loading skeleton");
    const html = renderToString(
      createElement(ClientOnly, { fallback }, "real content"),
    );
    expect(html).toContain("Loading skeleton");
    expect(html).toContain('class="skeleton"');
    expect(html).not.toContain("real content");
  });

  it("fallback can be a string", () => {
    const html = renderToString(
      createElement(ClientOnly, { fallback: "please wait" }),
    );
    expect(html).toContain("please wait");
  });
});

// ---------------------------------------------------------------------------
// Nested ServerOnly / ClientOnly
// ---------------------------------------------------------------------------

describe("Nested ServerOnly / ClientOnly", () => {
  it("ServerOnly inside ClientOnly fallback renders in SSR", () => {
    const html = renderToString(
      createElement(ClientOnly, {
        fallback: createElement(ServerOnly, null, "server-in-client-fallback"),
      }),
    );
    expect(html).toContain("server-in-client-fallback");
    expect(html).toContain("<capstan-server");
  });

  it("ClientOnly inside ServerOnly renders ClientOnly fallback", () => {
    const html = renderToString(
      createElement(
        ServerOnly,
        null,
        createElement(ClientOnly, {
          fallback: createElement("em", null, "nested-fallback"),
          children: createElement("span", null, "hidden"),
        }),
      ),
    );
    expect(html).toContain("nested-fallback");
    expect(html).not.toContain("hidden");
  });
});

// ---------------------------------------------------------------------------
// serverOnly() guard
// ---------------------------------------------------------------------------

describe("serverOnly() guard", () => {
  it("does NOT throw on server (typeof window === 'undefined')", () => {
    // In Bun test environment, window is not defined by default
    expect(() => serverOnly()).not.toThrow();
  });

  it("throws when window is defined", () => {
    // Mock globalThis.window
    (globalThis as Record<string, unknown>).window = {};
    try {
      expect(() => serverOnly()).toThrow(
        "This module is server-only and cannot be imported in client code.",
      );
    } finally {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  it("error message is descriptive", () => {
    (globalThis as Record<string, unknown>).window = {};
    try {
      serverOnly();
      expect.unreachable("should have thrown");
    } catch (e: unknown) {
      expect((e as Error).message).toContain("server-only");
      expect((e as Error).message).toContain("client code");
    } finally {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  it("does not throw after window is deleted again", () => {
    // Ensure cleanup of window doesn't leave state
    (globalThis as Record<string, unknown>).window = {};
    delete (globalThis as Record<string, unknown>).window;
    expect(() => serverOnly()).not.toThrow();
  });

  it("throws when window is set to a truthy non-object", () => {
    (globalThis as Record<string, unknown>).window = true;
    try {
      expect(() => serverOnly()).toThrow();
    } finally {
      delete (globalThis as Record<string, unknown>).window;
    }
  });
});
