import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  PageContext,
  defineLoader,
  useLoaderData,
  Outlet,
  OutletProvider,
  useAuth,
  useParams,
  normalizePagePath,
  invalidatePagePath,
  invalidatePageTag,
} from "@zauso-ai/capstan-react";
import type { CapstanPageContext, LoaderArgs } from "@zauso-ai/capstan-react";

// ---------------------------------------------------------------------------
// PageContext + useLoaderData
// ---------------------------------------------------------------------------

describe("PageContext", () => {
  it("has correct default value", () => {
    // Render a component that reads context without a provider — should get defaults
    function Reader() {
      const data = useLoaderData();
      return createElement("span", null, String(data));
    }

    const html = renderToString(createElement(Reader));
    // Default loaderData is null
    expect(html).toContain("null");
  });

  it("provides custom value through Provider", () => {
    const ctx: CapstanPageContext = {
      loaderData: { message: "hello" },
      params: { id: "42" },
      auth: { isAuthenticated: true, type: "human" },
    };

    function Reader() {
      const data = useLoaderData() as { message: string };
      return createElement("span", null, data.message);
    }

    const html = renderToString(
      createElement(PageContext.Provider, { value: ctx }, createElement(Reader)),
    );
    expect(html).toContain("hello");
  });
});

describe("defineLoader", () => {
  it("wraps function and returns it unchanged", () => {
    const fn = async (args: LoaderArgs) => ({ items: [] });
    const loader = defineLoader(fn);
    expect(loader).toBe(fn);
  });

  it("preserves async function behavior", async () => {
    const loader = defineLoader(async () => ({ count: 5 }));
    const result = await loader({
      params: {},
      request: new Request("http://localhost/"),
      ctx: { auth: { isAuthenticated: false, type: "anonymous" } },
      fetch: {
        get: async () => null as unknown,
        post: async () => null as unknown,
        put: async () => null as unknown,
        delete: async () => null as unknown,
      },
    });
    expect(result).toEqual({ count: 5 });
  });
});

// ---------------------------------------------------------------------------
// Outlet + OutletProvider
// ---------------------------------------------------------------------------

describe("OutletProvider + Outlet", () => {
  it("OutletProvider renders children", () => {
    const child = createElement("div", null, "child-content");
    const outletContent = createElement("p", null, "outlet-content");

    const html = renderToString(
      createElement(OutletProvider, { outlet: outletContent, children: child }),
    );

    expect(html).toContain("child-content");
  });

  it("Outlet renders the provided outlet content", () => {
    const outletContent = createElement("p", null, "outlet-stuff");

    // A layout component that uses Outlet
    function Layout() {
      return createElement(
        "div",
        { className: "layout" },
        createElement("h1", null, "Header"),
        createElement(Outlet),
      );
    }

    const html = renderToString(
      createElement(
        OutletProvider,
        {
          outlet: outletContent,
          children: createElement(Layout),
        },
      ),
    );

    expect(html).toContain("Header");
    expect(html).toContain("outlet-stuff");
  });

  it("Outlet renders null when no provider is present", () => {
    const html = renderToString(createElement(Outlet));
    // No content should render (null outlet)
    expect(html).toBe("");
  });

  it("nested OutletProviders use innermost value", () => {
    const inner = createElement("span", null, "inner-outlet");
    const outer = createElement("span", null, "outer-outlet");

    function Reader() {
      return createElement(Outlet);
    }

    const html = renderToString(
      createElement(
        OutletProvider,
        {
          outlet: outer,
          children: createElement(
            OutletProvider,
            {
              outlet: inner,
              children: createElement(Reader),
            },
          ),
        },
      ),
    );

    expect(html).toContain("inner-outlet");
    expect(html).not.toContain("outer-outlet");
  });
});

// ---------------------------------------------------------------------------
// useAuth, useParams
// ---------------------------------------------------------------------------

describe("useAuth", () => {
  it("returns default auth when no provider", () => {
    function AuthReader() {
      const auth = useAuth();
      return createElement("span", null, auth.type);
    }

    const html = renderToString(createElement(AuthReader));
    expect(html).toContain("anonymous");
  });

  it("returns custom auth from context", () => {
    const ctx: CapstanPageContext = {
      loaderData: null,
      params: {},
      auth: { isAuthenticated: true, type: "agent", role: "admin" },
    };

    function AuthReader() {
      const auth = useAuth();
      return createElement("span", null, `${auth.type}-${auth.isAuthenticated}`);
    }

    const html = renderToString(
      createElement(PageContext.Provider, { value: ctx }, createElement(AuthReader)),
    );
    expect(html).toContain("agent-true");
  });
});

describe("useParams", () => {
  it("returns empty params by default", () => {
    function ParamReader() {
      const params = useParams();
      return createElement("span", null, JSON.stringify(params));
    }

    const html = renderToString(createElement(ParamReader));
    expect(html).toContain("{}");
  });

  it("returns params from context", () => {
    const ctx: CapstanPageContext = {
      loaderData: null,
      params: { slug: "hello-world", id: "99" },
      auth: { isAuthenticated: false, type: "anonymous" },
    };

    function ParamReader() {
      const params = useParams();
      return createElement("span", null, `${params["slug"]}-${params["id"]}`);
    }

    const html = renderToString(
      createElement(PageContext.Provider, { value: ctx }, createElement(ParamReader)),
    );
    expect(html).toContain("hello-world-99");
  });
});

describe("render strategy exports", () => {
  it("exposes cache invalidation helpers on the public react entrypoint", () => {
    expect(typeof normalizePagePath).toBe("function");
    expect(typeof invalidatePagePath).toBe("function");
    expect(typeof invalidatePageTag).toBe("function");
    expect(normalizePagePath("https://example.com/docs?draft=1#intro")).toBe("/docs");
  });
});
