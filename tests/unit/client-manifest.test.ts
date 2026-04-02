import { describe, test, expect } from "bun:test";
import { matchRoute, findSharedLayout } from "@zauso-ai/capstan-react/client";
import type { ClientRouteManifest, ClientRouteEntry } from "@zauso-ai/capstan-react/client";

// ---------------------------------------------------------------------------
// matchRoute
// ---------------------------------------------------------------------------

function makeManifest(routes: ClientRouteEntry[]): ClientRouteManifest {
  return { routes };
}

function route(urlPattern: string, overrides?: Partial<ClientRouteEntry>): ClientRouteEntry {
  return {
    urlPattern,
    componentType: "server",
    layouts: [],
    ...overrides,
  };
}

describe("matchRoute", () => {
  test("exact static match", () => {
    const manifest = makeManifest([route("/about"), route("/contact")]);
    const result = matchRoute(manifest, "/about");
    expect(result).toBeDefined();
    expect(result!.route.urlPattern).toBe("/about");
    expect(result!.params).toEqual({});
  });

  test("root path matches", () => {
    const manifest = makeManifest([route("/")]);
    const result = matchRoute(manifest, "/");
    expect(result).toBeDefined();
    expect(result!.route.urlPattern).toBe("/");
  });

  test("dynamic segment extracts param", () => {
    const manifest = makeManifest([route("/posts/:id")]);
    const result = matchRoute(manifest, "/posts/42");
    expect(result).toBeDefined();
    expect(result!.params).toEqual({ id: "42" });
  });

  test("multiple dynamic segments", () => {
    const manifest = makeManifest([route("/users/:userId/posts/:postId")]);
    const result = matchRoute(manifest, "/users/abc/posts/123");
    expect(result).toBeDefined();
    expect(result!.params).toEqual({ userId: "abc", postId: "123" });
  });

  test("catch-all route", () => {
    const manifest = makeManifest([route("/docs/*")]);
    const result = matchRoute(manifest, "/docs/getting-started/install");
    expect(result).toBeDefined();
    expect(result!.params).toEqual({ "*": "getting-started/install" });
  });

  test("no match returns null", () => {
    const manifest = makeManifest([route("/about")]);
    expect(matchRoute(manifest, "/contact")).toBeNull();
  });

  test("path length mismatch returns null for static routes", () => {
    const manifest = makeManifest([route("/posts")]);
    expect(matchRoute(manifest, "/posts/extra")).toBeNull();
  });

  test("first matching route wins", () => {
    const manifest = makeManifest([
      route("/posts/:id"),
      route("/posts/new"),
    ]);
    const result = matchRoute(manifest, "/posts/new");
    expect(result).toBeDefined();
    // :id matches "new" — first route wins
    expect(result!.route.urlPattern).toBe("/posts/:id");
  });
});

// ---------------------------------------------------------------------------
// findSharedLayout
// ---------------------------------------------------------------------------

describe("findSharedLayout", () => {
  test("no shared layouts returns /", () => {
    const from = route("/a", { layouts: ["/a/_layout.tsx"] });
    const to = route("/b", { layouts: ["/b/_layout.tsx"] });
    expect(findSharedLayout(from, to)).toBe("/");
  });

  test("same root layout is shared", () => {
    const from = route("/a", { layouts: ["/_layout.tsx"] });
    const to = route("/b", { layouts: ["/_layout.tsx"] });
    expect(findSharedLayout(from, to)).toBe("/_layout.tsx");
  });

  test("deeper shared layout", () => {
    const from = route("/posts/1", { layouts: ["/_layout.tsx", "/posts/_layout.tsx"] });
    const to = route("/posts/2", { layouts: ["/_layout.tsx", "/posts/_layout.tsx"] });
    expect(findSharedLayout(from, to)).toBe("/posts/_layout.tsx");
  });

  test("divergent at second level", () => {
    const from = route("/posts/1", { layouts: ["/_layout.tsx", "/posts/_layout.tsx"] });
    const to = route("/users/1", { layouts: ["/_layout.tsx", "/users/_layout.tsx"] });
    expect(findSharedLayout(from, to)).toBe("/_layout.tsx");
  });

  test("from is undefined returns /", () => {
    const to = route("/about", { layouts: ["/_layout.tsx"] });
    expect(findSharedLayout(undefined, to)).toBe("/");
  });
});
