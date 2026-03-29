import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanRoutes,
  matchRoute,
  generateRouteManifest,
} from "@capstan/router";
import type { RouteManifest } from "@capstan/router";

// ---------------------------------------------------------------------------
// Shared temp-dir lifecycle
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-router-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a file (and its parent directories) with empty content. */
async function touch(base: string, relativePath: string): Promise<void> {
  const fullPath = join(base, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, "", "utf-8");
}

// ---------------------------------------------------------------------------
// scanRoutes
// ---------------------------------------------------------------------------

describe("scanRoutes", () => {
  it("returns an empty manifest for a non-existent directory", async () => {
    const result = await scanRoutes("/tmp/no-such-dir-capstan-test");
    expect(result.routes).toEqual([]);
  });

  it("identifies .page.tsx files as page routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    const pages = manifest.routes.filter((r) => r.type === "page");
    expect(pages.length).toBe(1);
    expect(pages[0]!.urlPattern).toBe("/");
  });

  it("identifies .api.ts files as api routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "tickets/index.api.ts");

    const manifest = await scanRoutes(dir);
    const apis = manifest.routes.filter((r) => r.type === "api");
    expect(apis.length).toBe(1);
    expect(apis[0]!.urlPattern).toBe("/tickets");
    expect(apis[0]!.methods).toContain("GET");
    expect(apis[0]!.methods).toContain("POST");
  });

  it("identifies _layout.tsx files as layout routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "_layout.tsx");

    const manifest = await scanRoutes(dir);
    const layouts = manifest.routes.filter((r) => r.type === "layout");
    expect(layouts.length).toBe(1);
  });

  it("identifies _middleware.ts files as middleware routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "_middleware.ts");

    const manifest = await scanRoutes(dir);
    const mws = manifest.routes.filter((r) => r.type === "middleware");
    expect(mws.length).toBe(1);
  });

  it("converts index.page.tsx to /", async () => {
    const dir = await makeTempDir();
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page?.urlPattern).toBe("/");
  });

  it("converts tickets/index.api.ts to /tickets", async () => {
    const dir = await makeTempDir();
    await touch(dir, "tickets/index.api.ts");

    const manifest = await scanRoutes(dir);
    const api = manifest.routes.find((r) => r.type === "api");
    expect(api?.urlPattern).toBe("/tickets");
  });

  it("converts tickets/[id].page.tsx to /tickets/:id", async () => {
    const dir = await makeTempDir();
    await touch(dir, "tickets/[id].page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find((r) => r.type === "page");
    expect(page?.urlPattern).toBe("/tickets/:id");
    expect(page?.params).toContain("id");
  });

  it("converts nested dynamic segments", async () => {
    const dir = await makeTempDir();
    await touch(dir, "orgs/[orgId]/members/[memberId].api.ts");

    const manifest = await scanRoutes(dir);
    const api = manifest.routes.find((r) => r.type === "api");
    expect(api?.urlPattern).toBe("/orgs/:orgId/members/:memberId");
    expect(api?.params).toEqual(["orgId", "memberId"]);
  });

  it("collects parent layouts for nested routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "_layout.tsx");
    await touch(dir, "tickets/_layout.tsx");
    await touch(dir, "tickets/index.page.tsx");

    const manifest = await scanRoutes(dir);
    const page = manifest.routes.find(
      (r) => r.type === "page" && r.urlPattern === "/tickets",
    );
    expect(page?.layouts.length).toBe(2);
    expect(page?.layouts[0]).toContain("_layout.tsx");
    expect(page?.layouts[1]).toContain("tickets");
  });

  it("collects parent middlewares for nested routes", async () => {
    const dir = await makeTempDir();
    await touch(dir, "_middleware.ts");
    await touch(dir, "api/_middleware.ts");
    await touch(dir, "api/health.api.ts");

    const manifest = await scanRoutes(dir);
    const api = manifest.routes.find(
      (r) => r.type === "api" && r.urlPattern === "/api/health",
    );
    expect(api?.middlewares.length).toBe(2);
  });

  it("ignores non-route files", async () => {
    const dir = await makeTempDir();
    await touch(dir, "utils.ts");
    await touch(dir, "README.md");
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    expect(manifest.routes.length).toBe(1);
    expect(manifest.routes[0]!.type).toBe("page");
  });
});

// ---------------------------------------------------------------------------
// matchRoute
// ---------------------------------------------------------------------------

describe("matchRoute", () => {
  it("matches a static path exactly", async () => {
    const dir = await makeTempDir();
    await touch(dir, "about.page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/about");

    expect(match).not.toBeNull();
    expect(match!.route.urlPattern).toBe("/about");
    expect(Object.keys(match!.params).length).toBe(0);
  });

  it("matches a dynamic segment and extracts params", async () => {
    const dir = await makeTempDir();
    await touch(dir, "tickets/[id].page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/tickets/42");

    expect(match).not.toBeNull();
    expect(match!.params["id"]).toBe("42");
  });

  it("returns null for non-matching paths", async () => {
    const dir = await makeTempDir();
    await touch(dir, "about.page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/contact");
    expect(match).toBeNull();
  });

  it("prefers static segments over dynamic ones", async () => {
    const dir = await makeTempDir();
    await touch(dir, "tickets/new.page.tsx");
    await touch(dir, "tickets/[id].page.tsx");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/tickets/new");

    expect(match).not.toBeNull();
    expect(match!.route.urlPattern).toBe("/tickets/new");
    expect(Object.keys(match!.params).length).toBe(0);
  });

  it("matches API routes for POST method", async () => {
    const dir = await makeTempDir();
    await touch(dir, "tickets/index.api.ts");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "POST", "/tickets");

    expect(match).not.toBeNull();
    expect(match!.route.type).toBe("api");
  });

  it("skips layout and middleware entries", async () => {
    const dir = await makeTempDir();
    await touch(dir, "_layout.tsx");
    await touch(dir, "_middleware.ts");

    const manifest = await scanRoutes(dir);
    const match = matchRoute(manifest, "GET", "/");
    // Layouts/middlewares are not directly routable
    expect(match).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateRouteManifest
// ---------------------------------------------------------------------------

describe("generateRouteManifest", () => {
  it("extracts API routes from the manifest", async () => {
    const dir = await makeTempDir();
    await touch(dir, "tickets/index.api.ts");
    await touch(dir, "tickets/[id].api.ts");
    await touch(dir, "index.page.tsx");

    const manifest = await scanRoutes(dir);
    const result = generateRouteManifest(manifest);

    // Should only include API routes, not pages
    expect(result.apiRoutes.length).toBeGreaterThan(0);
    for (const route of result.apiRoutes) {
      expect(route.path).toMatch(/^\/tickets/);
      expect(["GET", "POST", "PUT", "DELETE", "PATCH"]).toContain(
        route.method,
      );
    }
  });

  it("expands each API route into one entry per HTTP method", async () => {
    const dir = await makeTempDir();
    await touch(dir, "items/index.api.ts");

    const manifest = await scanRoutes(dir);
    const result = generateRouteManifest(manifest);

    // Default methods: GET, POST, PUT, DELETE, PATCH
    const itemRoutes = result.apiRoutes.filter((r) => r.path === "/items");
    expect(itemRoutes.length).toBe(5);
  });

  it("excludes page routes from the API manifest", async () => {
    const dir = await makeTempDir();
    await touch(dir, "index.page.tsx");
    await touch(dir, "about.page.tsx");

    const manifest = await scanRoutes(dir);
    const result = generateRouteManifest(manifest);
    expect(result.apiRoutes.length).toBe(0);
  });
});
