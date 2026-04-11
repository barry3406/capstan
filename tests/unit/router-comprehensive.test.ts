import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanRoutes,
  matchRoute,
  generateRouteManifest,
  canonicalizeRouteManifest,
  createRouteConflictError,
  createRouteScanCache,
} from "@zauso-ai/capstan-router";
import type { RouteEntry, RouteManifest } from "@zauso-ai/capstan-router";

// ---------------------------------------------------------------------------
// Shared temp-dir lifecycle
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-router-comp-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

async function touch(base: string, relativePath: string, content = ""): Promise<void> {
  const fullPath = join(base, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

function buildManifest(routes: RouteEntry[], rootDir = "/tmp/test"): RouteManifest {
  return {
    routes,
    scannedAt: new Date().toISOString(),
    rootDir,
  };
}

function makeRoute(overrides: Partial<RouteEntry> & Pick<RouteEntry, "filePath" | "type" | "urlPattern">): RouteEntry {
  return {
    layouts: [],
    middlewares: [],
    params: [],
    isCatchAll: false,
    ...overrides,
  };
}

// ===========================================================================
// scanner.ts tests
// ===========================================================================

describe("scanner — comprehensive", () => {
  it("scan empty directory returns empty routes", async () => {
    const dir = await makeTempDir();
    const manifest = await scanRoutes(dir);
    expect(manifest.routes).toEqual([]);
    expect(manifest.rootDir).toBe(dir);
  });

  it("scan non-existent path returns empty manifest", async () => {
    const manifest = await scanRoutes("/tmp/does-not-exist-" + Date.now());
    expect(manifest.routes).toEqual([]);
  });

  it("scan a regular file (not a directory) returns empty manifest", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "regular.txt");
    await writeFile(filePath, "hi");
    const manifest = await scanRoutes(filePath);
    expect(manifest.routes).toEqual([]);
  });

  it("scan with .api.ts files produces API routes with all standard methods", async () => {
    const dir = await makeTempDir();
    await touch(dir, "users/index.api.ts");

    const manifest = await scanRoutes(dir);
    const api = manifest.routes.find((r) => r.type === "api");
    expect(api).toBeDefined();
    expect(api!.urlPattern).toBe("/users");
    expect(api!.methods).toEqual(["GET", "POST", "PUT", "DELETE", "PATCH"]);
  });

  it("scan with .page.tsx files produces page routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "dashboard.page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page).toBeDefined();
    expect(page!.urlPattern).toBe("/dashboard");
  });

  it("dynamic segments [id] are parsed correctly", async () => {
    const dir = await makeTempDir();
    await touch(dir, "posts/[postId].page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.urlPattern).toBe("/posts/:postId");
    expect(page!.params).toEqual(["postId"]);
    expect(page!.isCatchAll).toBe(false);
  });

  it("catch-all [...slug] is parsed correctly", async () => {
    const dir = await makeTempDir();
    await touch(dir, "docs/[...slug].page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.urlPattern).toBe("/docs/*");
    expect(page!.params).toContain("slug");
    expect(page!.isCatchAll).toBe(true);
  });

  it("route groups (marketing) are transparent in URL", async () => {
    const dir = await makeTempDir();
    await touch(dir, "(app)/settings.page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.urlPattern).toBe("/settings");
  });

  it("_layout.tsx detected as layout", async () => {
    const dir = await makeTempDir();
    await touch(dir, "admin/_layout.tsx");

    const manifest = await scanRoutes(dir);
    const layout = manifest.routes.find((r) => r.type === "layout");
    expect(layout).toBeDefined();
    expect(layout!.urlPattern).toBe("/admin");
  });

  it("_middleware.ts detected as middleware", async () => {
    const dir = await makeTempDir();
    await touch(dir, "api/_middleware.ts");

    const manifest = await scanRoutes(dir);
    const mw = manifest.routes.find((r) => r.type === "middleware");
    expect(mw).toBeDefined();
    expect(mw!.urlPattern).toBe("/api");
  });

  it("_loading.tsx detected as loading boundary", async () => {
    const dir = await makeTempDir();
    await touch(dir, "_loading.tsx");
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    const loading = manifest.routes.find((r) => r.type === "loading");
    expect(loading).toBeDefined();
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.loading).toBe(join(dir, "_loading.tsx"));
  });

  it("_error.tsx detected as error boundary", async () => {
    const dir = await makeTempDir();
    await touch(dir, "_error.tsx");
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    const error = manifest.routes.find((r) => r.type === "error");
    expect(error).toBeDefined();
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.error).toBe(join(dir, "_error.tsx"));
  });

  it("nested routes build correct URL paths", async () => {
    const dir = await makeTempDir();
    await touch(dir, "orgs/[orgId]/teams/[teamId]/members.page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.urlPattern).toBe("/orgs/:orgId/teams/:teamId/members");
    expect(page!.params).toEqual(["orgId", "teamId"]);
  });

  it("not-found.tsx scoped to its directory", async () => {
    const dir = await makeTempDir();
    await touch(dir, "admin/not-found.tsx");

    const manifest = await scanRoutes(dir);
    const nf = manifest.routes.find((r) => r.type === "not-found");
    expect(nf!.urlPattern).toBe("/admin");
  });

  it("ignores non-route files (utils.ts, types.ts, .json)", async () => {
    const dir = await makeTempDir();
    await touch(dir, "utils.ts");
    await touch(dir, "types.ts");
    await touch(dir, "data.json");
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    expect(manifest.routes.length).toBe(1);
  });

  it("handles deeply nested directories (5+ levels)", async () => {
    const dir = await makeTempDir();
    await touch(dir, "a/b/c/d/e/deep.page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.urlPattern).toBe("/a/b/c/d/e/deep");
  });

  it("dynamic directory segments contribute to params", async () => {
    const dir = await makeTempDir();
    await touch(dir, "[orgId]/settings.page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.urlPattern).toBe("/:orgId/settings");
    expect(page!.params).toContain("orgId");
  });

  it("client component detected via 'use client' directive", async () => {
    const dir = await makeTempDir();
    await touch(dir, "counter.page.tsx", '"use client";\nexport default function Counter() {}');

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.componentType).toBe("client");
  });

  it("server component is default when no directive", async () => {
    const dir = await makeTempDir();
    await touch(dir, "about.page.tsx", "export default function About() {}");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.componentType).toBe("server");
  });

  it("cache returns same manifest on second scan without changes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "index.page.tsx");

    const cache = createRouteScanCache();
    const m1 = await scanRoutes(dir, { cache });
    const m2 = await scanRoutes(dir, { cache });
    expect(m1.routes.length).toBe(m2.routes.length);
    expect(m1.routes[0]!.urlPattern).toBe(m2.routes[0]!.urlPattern);
  });

  it("cache invalidates when a file is added", async () => {
    const dir = await makeTempDir();
    await touch(dir, "index.page.tsx");

    const cache = createRouteScanCache();
    const m1 = await scanRoutes(dir, { cache });
    expect(m1.routes.length).toBe(1);

    await touch(dir, "about.page.tsx");
    const m2 = await scanRoutes(dir, { cache });
    expect(m2.routes.length).toBe(2);
  });

  it("changedFile hint with matching signature returns cached manifest", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "index.page.tsx");
    await touch(dir, "index.page.tsx", "export default function Home() {}");

    const cache = createRouteScanCache();
    await scanRoutes(dir, { cache });

    // Second scan with changedFile pointing to unchanged file
    const m2 = await scanRoutes(dir, { cache, changedFile: filePath });
    expect(m2.routes.length).toBe(1);
  });
});

// ===========================================================================
// validation.ts tests
// ===========================================================================

describe("validation — comprehensive", () => {
  it("valid routes with no conflicts produce empty diagnostics", async () => {
    const dir = await makeTempDir();
    await touch(dir, "index.page.tsx");
    await touch(dir, "about.page.tsx");
    await touch(dir, "api/health.api.ts");

    const manifest = await scanRoutes(dir);
    expect(manifest.diagnostics).toEqual([]);
  });

  it("duplicate page routes at same URL are detected", async () => {
    const dir = await makeTempDir();
    await touch(dir, "(a)/pricing.page.tsx");
    await touch(dir, "(b)/pricing.page.tsx");

    await expect(scanRoutes(dir)).rejects.toMatchObject({
      code: "ROUTE_CONFLICT",
    });
  });

  it("duplicate api routes at same URL are detected", async () => {
    const dir = await makeTempDir();
    await touch(dir, "(v1)/users.api.ts");
    await touch(dir, "(v2)/users.api.ts");

    await expect(scanRoutes(dir)).rejects.toMatchObject({
      code: "ROUTE_CONFLICT",
    });
  });

  it("ambiguous overlapping dynamic routes are detected", async () => {
    const dir = await makeTempDir();
    await touch(dir, "items/[id]/detail.page.tsx");
    await touch(dir, "items/x/[slug].page.tsx");

    try {
      await scanRoutes(dir);
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toMatchObject({ code: "ROUTE_CONFLICT" });
      const e = err as { diagnostics: Array<{ code: string }> };
      expect(e.diagnostics.some((d) => d.code === "ambiguous-route")).toBe(true);
    }
  });

  it("non-terminal catch-all is invalid", async () => {
    const dir = await makeTempDir();
    await touch(dir, "[...all]/child.page.tsx");

    try {
      await scanRoutes(dir);
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toMatchObject({ code: "ROUTE_CONFLICT" });
      const e = err as { diagnostics: Array<{ code: string }> };
      expect(e.diagnostics.some((d) => d.code === "invalid-route-pattern")).toBe(true);
    }
  });

  it("canonicalizeRouteManifest sorts direct routes before boundary routes", () => {
    const rootDir = "/tmp/test";
    const routes: RouteEntry[] = [
      makeRoute({ filePath: join(rootDir, "_layout.tsx"), type: "layout", urlPattern: "/" }),
      makeRoute({ filePath: join(rootDir, "index.page.tsx"), type: "page", urlPattern: "/" }),
      makeRoute({ filePath: join(rootDir, "_middleware.ts"), type: "middleware", urlPattern: "/" }),
    ];

    const result = canonicalizeRouteManifest(routes, rootDir);
    expect(result.routes[0]!.type).toBe("page");
    expect(result.routes.at(-1)!.type).toBe("middleware");
  });

  it("canonicalizeRouteManifest prefers more static segments", () => {
    const rootDir = "/tmp/test";
    const routes: RouteEntry[] = [
      makeRoute({ filePath: join(rootDir, "a/[id].page.tsx"), type: "page", urlPattern: "/a/:id", params: ["id"] }),
      makeRoute({ filePath: join(rootDir, "a/b.page.tsx"), type: "page", urlPattern: "/a/b" }),
    ];

    const result = canonicalizeRouteManifest(routes, rootDir);
    expect(result.routes[0]!.urlPattern).toBe("/a/b");
  });

  it("canonicalizeRouteManifest sorts catch-all after non-catch-all at equal depth", () => {
    const rootDir = "/tmp/test";
    const routes: RouteEntry[] = [
      makeRoute({ filePath: join(rootDir, "docs/[...slug].page.tsx"), type: "page", urlPattern: "/docs/*", params: ["slug"], isCatchAll: true }),
      makeRoute({ filePath: join(rootDir, "docs/[id].page.tsx"), type: "page", urlPattern: "/docs/:id", params: ["id"] }),
    ];

    const result = canonicalizeRouteManifest(routes, rootDir);
    expect(result.routes[0]!.urlPattern).toBe("/docs/:id");
    expect(result.routes[1]!.urlPattern).toBe("/docs/*");
  });

  it("createRouteConflictError produces error with correct structure", () => {
    const diagnostics = [{
      code: "duplicate-route" as const,
      severity: "error" as const,
      message: "Duplicate page route for /about",
      routeType: "page" as const,
      urlPattern: "/about",
      canonicalPattern: "/about",
      filePaths: ["/a.tsx", "/b.tsx"],
    }];

    const err = createRouteConflictError(diagnostics);
    expect(err.code).toBe("ROUTE_CONFLICT");
    expect(err.conflicts).toHaveLength(1);
    expect(err.conflicts[0]!.reason).toBe("duplicate-route");
    expect(err.conflicts[0]!.filePaths).toEqual(["/a.tsx", "/b.tsx"]);
    expect(err.message).toContain("Route conflict detected");
  });

  it("createRouteConflictError with multiple conflicts uses plural message", () => {
    const diagnostics = [
      {
        code: "duplicate-route" as const, severity: "error" as const, message: "dup",
        routeType: "page" as const, urlPattern: "/a", canonicalPattern: "/a", filePaths: ["/a.tsx", "/b.tsx"],
      },
      {
        code: "duplicate-route" as const, severity: "error" as const, message: "dup",
        routeType: "api" as const, urlPattern: "/b", canonicalPattern: "/b", filePaths: ["/c.ts", "/d.ts"],
      },
    ];

    const err = createRouteConflictError(diagnostics);
    expect(err.message).toContain("2 route groups");
    expect(err.conflicts).toHaveLength(2);
  });

  it("page routes with duplicate params are flagged as invalid", async () => {
    const rootDir = "/tmp/test";
    const routes: RouteEntry[] = [
      makeRoute({
        filePath: join(rootDir, "[id]/[id].page.tsx"),
        type: "page",
        urlPattern: "/:id/:id",
        params: ["id", "id"],
      }),
    ];

    const result = canonicalizeRouteManifest(routes, rootDir);
    expect(result.diagnostics.some((d) => d.code === "invalid-route-pattern")).toBe(true);
  });

  it("ambiguous not-found routes at the same scope are detected", async () => {
    const dir = await makeTempDir();
    await touch(dir, "(a)/not-found.tsx");
    await touch(dir, "(b)/not-found.tsx");

    await expect(scanRoutes(dir)).rejects.toMatchObject({ code: "ROUTE_CONFLICT" });
  });

  it("static analysis warns on boundary files exporting page-only exports", async () => {
    const dir = await makeTempDir();
    await touch(dir, "_layout.tsx", 'export const loader = () => {};\nexport default function Layout() {}');
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    const warnings = (manifest.diagnostics ?? []).filter((d) => d.severity === "warning");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.message.includes("loader"))).toBe(true);
  });

  it("static analysis warns on invalid renderMode", async () => {
    const dir = await makeTempDir();
    await touch(dir, "bad.page.tsx", 'export const renderMode = "invalid-mode";\nexport default function Bad() {}');

    const manifest = await scanRoutes(dir);
    const warnings = (manifest.diagnostics ?? []).filter((d) => d.severity === "warning");
    expect(warnings.some((w) => w.message.includes("renderMode"))).toBe(true);
  });

  it("static analysis warns on generateStaticParams without dynamic params", async () => {
    const dir = await makeTempDir();
    await touch(dir, "static.page.tsx", 'export function generateStaticParams() { return []; }\nexport default function Static() {}');

    const manifest = await scanRoutes(dir);
    const warnings = (manifest.diagnostics ?? []).filter((d) => d.severity === "warning");
    expect(warnings.some((w) => w.message.includes("generateStaticParams"))).toBe(true);
  });
});

// ===========================================================================
// matcher.ts tests
// ===========================================================================

describe("matcher — comprehensive", () => {
  it("exact path match", async () => {
    const dir = await makeTempDir();
    await touch(dir, "about.page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/about");
    expect(match).not.toBeNull();
    expect(match!.route.urlPattern).toBe("/about");
    expect(match!.params).toEqual({});
  });

  it("dynamic segment match (/users/123)", async () => {
    const dir = await makeTempDir();
    await touch(dir, "users/[id].page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/users/123");
    expect(match!.params["id"]).toBe("123");
  });

  it("catch-all match (/docs/a/b/c)", async () => {
    const dir = await makeTempDir();
    await touch(dir, "docs/[...slug].page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/docs/a/b/c");
    expect(match).not.toBeNull();
    expect(match!.params["slug"]).toBe("a/b/c");
  });

  it("no match returns null", async () => {
    const dir = await makeTempDir();
    await touch(dir, "about.page.tsx");

    const manifest = await scanRoutes(dir);
    expect(matchRoute(manifest, "GET", "/nonexistent")).toBeNull();
  });

  it("priority: exact > dynamic > catch-all", async () => {
    const dir = await makeTempDir();
    await touch(dir, "items/special.page.tsx");
    await touch(dir, "items/[id].page.tsx");
    await touch(dir, "items/[...rest].page.tsx");

    const manifest = await scanRoutes(dir);

    const exactMatch = matchRoute(manifest, "GET", "/items/special");
    expect(exactMatch!.route.urlPattern).toBe("/items/special");

    const dynamicMatch = matchRoute(manifest, "GET", "/items/42");
    expect(dynamicMatch!.route.urlPattern).toBe("/items/:id");

    const catchAllMatch = matchRoute(manifest, "GET", "/items/a/b/c");
    expect(catchAllMatch!.route.urlPattern).toBe("/items/*");
  });

  it("trailing slash is normalized", async () => {
    const dir = await makeTempDir();
    await touch(dir, "about.page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/about/");
    expect(match).not.toBeNull();
    expect(match!.route.urlPattern).toBe("/about");
  });

  it("repeated slashes are normalized", async () => {
    const dir = await makeTempDir();
    await touch(dir, "about.page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "///about///");
    expect(match).not.toBeNull();
    expect(match!.route.urlPattern).toBe("/about");
  });

  it("method case insensitive", async () => {
    const dir = await makeTempDir();
    await touch(dir, "items.api.ts");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "post", "/items");
    expect(match).not.toBeNull();
    expect(match!.route.type).toBe("api");
  });

  it("for non-GET, API routes are preferred over page routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "items.api.ts");
    await touch(dir, "items.page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "POST", "/items");
    expect(match!.route.type).toBe("api");
  });

  it("for GET, page routes are preferred over API routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "items.api.ts");
    await touch(dir, "items.page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/items");
    expect(match!.route.type).toBe("page");
  });

  it("not-found fallback only for GET and HEAD", async () => {
    const dir = await makeTempDir();
    await touch(dir, "not-found.tsx");

    const manifest = await scanRoutes(dir);
    expect(matchRoute(manifest, "GET", "/missing")).not.toBeNull();
    expect(matchRoute(manifest, "HEAD", "/missing")).not.toBeNull();
    expect(matchRoute(manifest, "POST", "/missing")).toBeNull();
    expect(matchRoute(manifest, "DELETE", "/missing")).toBeNull();
  });

  it("decoded URL params", async () => {
    const dir = await makeTempDir();
    await touch(dir, "users/[name].page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/users/hello%20world");
    expect(match!.params["name"]).toBe("hello world");
  });

  it("root index match", async () => {
    const dir = await makeTempDir();
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/");
    expect(match).not.toBeNull();
    expect(match!.route.urlPattern).toBe("/");
  });

  it("deeper not-found preferred over shallower", async () => {
    const dir = await makeTempDir();
    await touch(dir, "not-found.tsx");
    await touch(dir, "docs/not-found.tsx");
    await touch(dir, "docs/guides/not-found.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/docs/guides/missing");
    expect(match!.route.filePath).toBe(join(dir, "docs", "guides", "not-found.tsx"));
  });

  it("not-found does not match outside its scope", async () => {
    const dir = await makeTempDir();
    await touch(dir, "admin/not-found.tsx");

    const manifest = await scanRoutes(dir);
    expect(matchRoute(manifest, "GET", "/public/missing")).toBeNull();
  });
});

// ===========================================================================
// static-analysis.ts tests
// ===========================================================================

describe("static-analysis — comprehensive", () => {
  it("detects default export", async () => {
    const dir = await makeTempDir();
    await touch(dir, "page.page.tsx", "export default function Page() {}");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.staticInfo?.exportNames).toContain("default");
  });

  it("detects named exports (const, function, class)", async () => {
    const dir = await makeTempDir();
    await touch(dir, "page.page.tsx",
      'export const loader = () => {};\nexport function action() {}\nexport default function Page() {}');

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.staticInfo?.exportNames).toContain("loader");
    expect(page!.staticInfo?.exportNames).toContain("action");
    expect(page!.staticInfo?.exportNames).toContain("default");
  });

  it("detects re-exports via export { ... }", async () => {
    const dir = await makeTempDir();
    await touch(dir, "barrel.api.ts", 'const foo = 1;\nconst bar = 2;\nexport { foo, bar }');

    const manifest = await scanRoutes(dir);
    const api = manifest.routes.find((r) => r.type === "api");
    expect(api!.staticInfo?.exportNames).toContain("foo");
    expect(api!.staticInfo?.exportNames).toContain("bar");
  });

  it("detects aliased re-exports", async () => {
    const dir = await makeTempDir();
    await touch(dir, "alias.api.ts", 'const x = 1;\nexport { x as myExport }');

    const manifest = await scanRoutes(dir);
    const api = manifest.routes.find((r) => r.type === "api");
    expect(api!.staticInfo?.exportNames).toContain("myExport");
  });

  it("detects renderMode ssr", async () => {
    const dir = await makeTempDir();
    await touch(dir, "ssr.page.tsx", 'export const renderMode = "ssr";\nexport default function SSR() {}');

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.staticInfo?.renderMode).toBe("ssr");
  });

  it("detects renderMode ssg", async () => {
    const dir = await makeTempDir();
    await touch(dir, "ssg.page.tsx", 'export const renderMode = "ssg";\nexport default function SSG() {}');

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.staticInfo?.renderMode).toBe("ssg");
  });

  it("detects renderMode streaming", async () => {
    const dir = await makeTempDir();
    await touch(dir, "stream.page.tsx", 'export const renderMode = "streaming";\nexport default function Stream() {}');

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.staticInfo?.renderMode).toBe("streaming");
  });

  it("detects revalidate number", async () => {
    const dir = await makeTempDir();
    await touch(dir, "isr.page.tsx", 'export const revalidate = 3600;\nexport default function ISR() {}');

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.staticInfo?.revalidate).toBe(3600);
  });

  it("detects metadata export", async () => {
    const dir = await makeTempDir();
    await touch(dir, "meta.page.tsx", 'export const metadata = { title: "Test" };\nexport default function Meta() {}');

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page!.staticInfo?.hasMetadata).toBe(true);
  });

  it("warns on ssg page with dynamic params but no generateStaticParams", async () => {
    const dir = await makeTempDir();
    await touch(dir, "[id].page.tsx", 'export const renderMode = "ssg";\nexport default function Page() {}');

    const manifest = await scanRoutes(dir);
    const warnings = (manifest.diagnostics ?? []).filter((d) => d.severity === "warning");
    expect(warnings.some((w) => w.message.includes("generateStaticParams"))).toBe(true);
  });
});

// ===========================================================================
// manifest.ts (generateRouteManifest) tests
// ===========================================================================

describe("generateRouteManifest — comprehensive", () => {
  it("returns empty apiRoutes for page-only manifest", async () => {
    const dir = await makeTempDir();
    await touch(dir, "index.page.tsx");
    await touch(dir, "about.page.tsx");

    const manifest = await scanRoutes(dir);
    const result = generateRouteManifest(manifest);
    expect(result.apiRoutes).toEqual([]);
  });

  it("expands each API route into 5 method entries", async () => {
    const dir = await makeTempDir();
    await touch(dir, "users.api.ts");

    const manifest = await scanRoutes(dir);
    const result = generateRouteManifest(manifest);
    expect(result.apiRoutes.length).toBe(5);
    const methods = result.apiRoutes.map((r) => r.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
  });

  it("preserves URL patterns in expanded routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "users/[id].api.ts");

    const manifest = await scanRoutes(dir);
    const result = generateRouteManifest(manifest);
    for (const route of result.apiRoutes) {
      expect(route.path).toBe("/users/:id");
    }
  });

  it("includes filePath in expanded routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "health.api.ts");

    const manifest = await scanRoutes(dir);
    const result = generateRouteManifest(manifest);
    for (const route of result.apiRoutes) {
      expect(route.filePath).toBe(join(dir, "health.api.ts"));
    }
  });
});
