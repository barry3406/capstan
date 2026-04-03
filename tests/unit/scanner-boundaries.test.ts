import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanRoutes } from "@zauso-ai/capstan-router";
import type { RouteEntry } from "@zauso-ai/capstan-router";

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "scanner-boundaries-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function createFile(relativePath: string, content = ""): Promise<void> {
  const fullPath = join(tempDir, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

function findPage(routes: RouteEntry[], urlPattern: string): RouteEntry | undefined {
  return routes.find((r) => r.type === "page" && r.urlPattern === urlPattern);
}

// ---------------------------------------------------------------------------
// Basic detection
// ---------------------------------------------------------------------------

describe("_loading.tsx / _error.tsx detection", () => {
  test("root _loading.tsx associated with root page", async () => {
    await createFile("_loading.tsx", "export default function L() {}");
    await createFile("index.page.tsx", "export default function P() {}");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");

    expect(page).toBeDefined();
    expect(page!.loading).toBe(join(tempDir, "_loading.tsx"));
    expect(page!.error).toBeUndefined();
  });

  test("root _error.tsx associated with root page", async () => {
    await createFile("_error.tsx", "export default function E() {}");
    await createFile("index.page.tsx", "export default function P() {}");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");

    expect(page).toBeDefined();
    expect(page!.error).toBe(join(tempDir, "_error.tsx"));
    expect(page!.loading).toBeUndefined();
  });

  test("both _loading and _error at root", async () => {
    await createFile("_loading.tsx", "export default function L() {}");
    await createFile("_error.tsx", "export default function E() {}");
    await createFile("index.page.tsx", "export default function P() {}");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");

    expect(page!.loading).toBe(join(tempDir, "_loading.tsx"));
    expect(page!.error).toBe(join(tempDir, "_error.tsx"));
  });

  test("wrong extension (_loading.jsx) is NOT detected as boundary", async () => {
    await createFile("_loading.jsx", "export default function L() {}");
    await createFile("index.page.tsx", "export default function P() {}");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");

    expect(page).toBeDefined();
    expect(page!.loading).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Nearest-wins (innermost overrides parent)
// ---------------------------------------------------------------------------

describe("nearest-wins inheritance", () => {
  test("inner _loading.tsx overrides root", async () => {
    await createFile("_loading.tsx", "");
    await createFile("posts/_loading.tsx", "");
    await createFile("posts/index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/posts");

    expect(page!.loading).toBe(join(tempDir, "posts", "_loading.tsx"));
  });

  test("inner _error.tsx overrides root", async () => {
    await createFile("_error.tsx", "");
    await createFile("posts/_error.tsx", "");
    await createFile("posts/index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/posts");

    expect(page!.error).toBe(join(tempDir, "posts", "_error.tsx"));
  });

  test("deeply nested: 3 levels, innermost wins", async () => {
    await createFile("_loading.tsx", "");
    await createFile("posts/_loading.tsx", "");
    await createFile("posts/comments/_loading.tsx", "");
    await createFile("posts/comments/index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/posts/comments");

    expect(page!.loading).toBe(join(tempDir, "posts", "comments", "_loading.tsx"));
  });

  test("deeply nested: skips middle level, inherits from grandparent", async () => {
    await createFile("_error.tsx", "");
    // NO posts/_error.tsx at level 1
    await createFile("posts/comments/index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/posts/comments");

    expect(page!.error).toBe(join(tempDir, "_error.tsx"));
  });

  test("_loading at root, _error at child: page gets both from different levels", async () => {
    await createFile("_loading.tsx", "");
    await createFile("posts/_error.tsx", "");
    await createFile("posts/index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/posts");

    expect(page!.loading).toBe(join(tempDir, "_loading.tsx"));
    expect(page!.error).toBe(join(tempDir, "posts", "_error.tsx"));
  });

  test("child overrides loading, inherits error from root", async () => {
    await createFile("_loading.tsx", "");
    await createFile("_error.tsx", "");
    await createFile("posts/_loading.tsx", "");
    await createFile("posts/index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/posts");

    // Loading is overridden at child level
    expect(page!.loading).toBe(join(tempDir, "posts", "_loading.tsx"));
    // Error inherits from root (no posts/_error.tsx)
    expect(page!.error).toBe(join(tempDir, "_error.tsx"));
  });
});

// ---------------------------------------------------------------------------
// No boundary files
// ---------------------------------------------------------------------------

describe("no boundary files", () => {
  test("page without any _loading/_error gets undefined for both", async () => {
    await createFile("index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");

    expect(page!.loading).toBeUndefined();
    expect(page!.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dynamic and catch-all routes
// ---------------------------------------------------------------------------

describe("dynamic and catch-all routes", () => {
  test("dynamic segment page inherits root boundaries", async () => {
    await createFile("_loading.tsx", "");
    await createFile("_error.tsx", "");
    await createFile("posts/[id].page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/posts/:id");

    expect(page).toBeDefined();
    expect(page!.loading).toBe(join(tempDir, "_loading.tsx"));
    expect(page!.error).toBe(join(tempDir, "_error.tsx"));
  });

  test("catch-all route inherits boundaries", async () => {
    await createFile("_loading.tsx", "");
    await createFile("[...rest].page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = routes.find((r) => r.type === "page" && r.isCatchAll);

    expect(page).toBeDefined();
    expect(page!.loading).toBe(join(tempDir, "_loading.tsx"));
  });

  test("dynamic dir with own boundary", async () => {
    await createFile("[orgId]/_loading.tsx", "");
    await createFile("[orgId]/dashboard.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/:orgId/dashboard");

    expect(page!.loading).toBe(join(tempDir, "[orgId]", "_loading.tsx"));
  });

  test("nested dynamic: boundary at parent, page at dynamic child", async () => {
    await createFile("_error.tsx", "");
    await createFile("users/[userId]/settings.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/users/:userId/settings");

    expect(page).toBeDefined();
    expect(page!.error).toBe(join(tempDir, "_error.tsx"));
  });
});

// ---------------------------------------------------------------------------
// Manifest structure
// ---------------------------------------------------------------------------

describe("manifest structure", () => {
  test("_loading.tsx and _error.tsx appear as their own route types", async () => {
    await createFile("_loading.tsx", "");
    await createFile("_error.tsx", "");
    await createFile("index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    expect(routes.some((r) => r.type === "loading")).toBe(true);
    expect(routes.some((r) => r.type === "error")).toBe(true);
  });

  test("loading/error entries are not routable (no methods, empty layouts)", async () => {
    await createFile("_loading.tsx", "");
    await createFile("_error.tsx", "");
    await createFile("index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const loading = routes.find((r) => r.type === "loading")!;
    const error = routes.find((r) => r.type === "error")!;

    expect(loading.methods).toBeUndefined();
    expect(error.methods).toBeUndefined();
    expect(loading.layouts).toEqual([]);
    expect(error.layouts).toEqual([]);
  });

  test("API routes do NOT get loading/error fields", async () => {
    await createFile("_loading.tsx", "");
    await createFile("_error.tsx", "");
    await createFile("index.api.ts", "export const GET = {};");

    const { routes } = await scanRoutes(tempDir);
    const api = routes.find((r) => r.type === "api");

    expect(api).toBeDefined();
    expect(api!.loading).toBeUndefined();
    expect(api!.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple pages at different levels
// ---------------------------------------------------------------------------

describe("multiple pages at different levels", () => {
  test("sibling pages share the same boundary", async () => {
    await createFile("_loading.tsx", "");
    await createFile("about.page.tsx", "");
    await createFile("contact.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const about = findPage(routes, "/about");
    const contact = findPage(routes, "/contact");

    expect(about!.loading).toBe(join(tempDir, "_loading.tsx"));
    expect(contact!.loading).toBe(join(tempDir, "_loading.tsx"));
  });

  test("pages at different nesting levels get different boundaries", async () => {
    await createFile("_loading.tsx", "");
    await createFile("posts/_loading.tsx", "");
    await createFile("index.page.tsx", "");
    await createFile("posts/index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const root = findPage(routes, "/");
    const posts = findPage(routes, "/posts");

    expect(root!.loading).toBe(join(tempDir, "_loading.tsx"));
    expect(posts!.loading).toBe(join(tempDir, "posts", "_loading.tsx"));
  });

  test("three sibling dirs: only one has local boundary, others inherit root", async () => {
    await createFile("_error.tsx", "");
    await createFile("a/index.page.tsx", "");
    await createFile("b/_error.tsx", "");
    await createFile("b/index.page.tsx", "");
    await createFile("c/index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const a = findPage(routes, "/a");
    const b = findPage(routes, "/b");
    const c = findPage(routes, "/c");

    // a and c inherit from root
    expect(a!.error).toBe(join(tempDir, "_error.tsx"));
    expect(c!.error).toBe(join(tempDir, "_error.tsx"));
    // b has its own
    expect(b!.error).toBe(join(tempDir, "b", "_error.tsx"));
  });
});

// ---------------------------------------------------------------------------
// Component type detection
// ---------------------------------------------------------------------------

describe("detectComponentType via scan", () => {
  test("page with 'use client' directive is classified as client", async () => {
    await createFile("index.page.tsx", '"use client";\nexport default function P() {}');
    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");
    expect(page!.componentType).toBe("client");
  });

  test("page without directive is classified as server", async () => {
    await createFile("index.page.tsx", "export default function P() {}");
    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");
    expect(page!.componentType).toBe("server");
  });

  test("single-quoted 'use client' is also detected", async () => {
    await createFile("index.page.tsx", "'use client';\nexport default function P() {}");
    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");
    expect(page!.componentType).toBe("client");
  });
});

// ---------------------------------------------------------------------------
// Route groups and not-found boundaries
// ---------------------------------------------------------------------------

describe("route groups and not-found boundaries", () => {
  test("route groups do not contribute url segments but do contribute boundaries", async () => {
    await createFile("(marketing)/_loading.tsx", "");
    await createFile("(marketing)/_error.tsx", "");
    await createFile("(marketing)/landing.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/landing");

    expect(page).toBeDefined();
    expect(page!.loading).toBe(join(tempDir, "(marketing)", "_loading.tsx"));
    expect(page!.error).toBe(join(tempDir, "(marketing)", "_error.tsx"));
  });

  test("nested route groups remain transparent in the url", async () => {
    await createFile("(marketing)/(campaigns)/offers.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/offers");

    expect(page).toBeDefined();
    expect(page!.urlPattern).toBe("/offers");
  });

  test("not-found boundary inherits to descendant page routes", async () => {
    await createFile("docs/not-found.tsx", "");
    await createFile("docs/guides/install.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/docs/guides/install");

    expect(page).toBeDefined();
    expect(page!.notFound).toBe(join(tempDir, "docs", "not-found.tsx"));
  });

  test("nearest not-found boundary wins over a root fallback", async () => {
    await createFile("not-found.tsx", "");
    await createFile("docs/not-found.tsx", "");
    await createFile("docs/intro.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/docs/intro");

    expect(page).toBeDefined();
    expect(page!.notFound).toBe(join(tempDir, "docs", "not-found.tsx"));
  });

  test("pages without a not-found boundary keep notFound undefined", async () => {
    await createFile("index.page.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const page = findPage(routes, "/");

    expect(page).toBeDefined();
    expect(page!.notFound).toBeUndefined();
  });

  test("not-found entries appear as their own route type and use directory scope", async () => {
    await createFile("(marketing)/docs/_layout.tsx", "");
    await createFile("(marketing)/docs/_middleware.ts", "");
    await createFile("(marketing)/docs/not-found.tsx", "");

    const { routes } = await scanRoutes(tempDir);
    const notFound = routes.find((r) => r.type === "not-found");

    expect(notFound).toBeDefined();
    expect(notFound!.urlPattern).toBe("/docs");
    expect(notFound!.layouts).toEqual([join(tempDir, "(marketing)", "docs", "_layout.tsx")]);
    expect(notFound!.middlewares).toEqual([join(tempDir, "(marketing)", "docs", "_middleware.ts")]);
  });
});
