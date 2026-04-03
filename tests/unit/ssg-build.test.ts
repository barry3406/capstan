import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildStaticPages } from "@zauso-ai/capstan-dev";
import type { RouteManifest } from "@zauso-ai/capstan-router";

// ---------------------------------------------------------------------------
// Helpers — create a minimal compilable project in a temp directory
// ---------------------------------------------------------------------------

let tempDir: string;
let outputDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ssg-build-test-"));
  outputDir = join(tempDir, "dist", "static");

  const routesDir = join(tempDir, "routes");
  await mkdir(routesDir, { recursive: true });
  await mkdir(join(routesDir, "blog"), { recursive: true });

  // SSG page (static, no params)
  await writeFile(
    join(routesDir, "about.page.js"),
    `
export const renderMode = "ssg";
export default function About() { return null; }
`,
  );

  // SSR page (should be skipped)
  await writeFile(
    join(routesDir, "index.page.js"),
    `
export default function Home() { return null; }
`,
  );

  // SSG page with dynamic params
  await writeFile(
    join(routesDir, "blog", "[id].page.js"),
    `
export const renderMode = "ssg";
export default function BlogPost() { return null; }
export async function generateStaticParams() {
  return [{ id: "1" }, { id: "2" }, { id: "3" }];
}
`,
  );

  // SSG page with dynamic params but NO generateStaticParams (should error)
  await writeFile(
    join(routesDir, "blog", "[slug].page.js"),
    `
export const renderMode = "ssg";
export default function BlogBySlug() { return null; }
`,
  );

  // ISR page (should be skipped)
  await writeFile(
    join(routesDir, "dashboard.page.js"),
    `
export const renderMode = "isr";
export const revalidate = 60;
export default function Dashboard() { return null; }
`,
  );

  // Root SSG page (urlPattern = "/")
  await writeFile(
    join(routesDir, "root.page.js"),
    `
export const renderMode = "ssg";
export default function Root() { return null; }
`,
  );

  // SSG page without default export
  await writeFile(
    join(routesDir, "empty.page.js"),
    `
export const renderMode = "ssg";
export const title = "No default";
`,
  );

  // Dynamic SSG page with empty generateStaticParams
  await mkdir(join(routesDir, "tags"), { recursive: true });
  await writeFile(
    join(routesDir, "tags", "[name].page.js"),
    `
export const renderMode = "ssg";
export default function Tag() { return null; }
export async function generateStaticParams() {
  return [];
}
`,
  );

  // Dynamic SSG page with throwing generateStaticParams
  await mkdir(join(routesDir, "error"), { recursive: true });
  await writeFile(
    join(routesDir, "error", "[code].page.js"),
    `
export const renderMode = "ssg";
export default function ErrorPage() { return null; }
export async function generateStaticParams() {
  throw new Error("DB connection failed");
}
`,
  );

  // Catch-all SSG page
  await mkdir(join(routesDir, "docs"), { recursive: true });
  await writeFile(
    join(routesDir, "docs", "[...slug].page.js"),
    `
export const renderMode = "ssg";
export default function DocsPage() { return null; }
export async function generateStaticParams() {
  return [{ slug: "intro" }, { slug: "guide/setup" }];
}
`,
  );
});

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildStaticPages", () => {
  test("skips non-SSG pages", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "index.page.js"),
          type: "page",
          urlPattern: "/",
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
        {
          filePath: join(tempDir, "routes", "dashboard.page.js"),
          type: "page",
          urlPattern: "/dashboard",
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(0);
    expect(result.paths).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("pre-renders static SSG page (no params)", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "about.page.js"),
          type: "page",
          urlPattern: "/about",
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(1);
    expect(result.paths).toContain("/about");

    // Verify file was written
    const html = await readFile(join(outputDir, "about", "index.html"), "utf-8");
    expect(html).toContain("</html>");
  });

  test("pre-renders dynamic SSG page with generateStaticParams", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "blog", "[id].page.js"),
          type: "page",
          urlPattern: "/blog/:id",
          layouts: [],
          middlewares: [],
          params: ["id"],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(3);
    expect(result.paths).toContain("/blog/1");
    expect(result.paths).toContain("/blog/2");
    expect(result.paths).toContain("/blog/3");

    // Verify files were written
    for (const id of ["1", "2", "3"]) {
      const html = await readFile(join(outputDir, "blog", id, "index.html"), "utf-8");
      expect(html.length).toBeGreaterThan(0);
    }
  });

  test("errors when dynamic SSG page missing generateStaticParams", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "blog", "[slug].page.js"),
          type: "page",
          urlPattern: "/blog/:slug",
          layouts: [],
          middlewares: [],
          params: ["slug"],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("generateStaticParams");
  });

  test("writes _ssg_manifest.json with correct paths", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "about.page.js"),
          type: "page",
          urlPattern: "/about",
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    // Clean output first
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(1);

    const manifestJson = JSON.parse(
      await readFile(join(outputDir, "_ssg_manifest.json"), "utf-8"),
    );
    expect(manifestJson.paths).toContain("/about");
    expect(manifestJson.generatedAt).toBeDefined();
  });

  test("skips API routes", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "index.page.js"),
          type: "api",
          urlPattern: "/api/health",
          methods: ["GET"],
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("handles missing page module gracefully", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "nonexistent.page.js"),
          type: "page",
          urlPattern: "/nonexistent",
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Failed to import");
  });

  test("generateStaticParams returns empty array → 0 pages, no error", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "tags", "[name].page.js"),
          type: "page",
          urlPattern: "/tags/:name",
          layouts: [],
          middlewares: [],
          params: ["name"],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(0);
    expect(result.paths).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("generateStaticParams throws → error captured", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "error", "[code].page.js"),
          type: "page",
          urlPattern: "/error/:code",
          layouts: [],
          middlewares: [],
          params: ["code"],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("generateStaticParams() failed");
    expect(result.errors[0]).toContain("DB connection failed");
  });

  test("SSG page without default export → error", async () => {
    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "empty.page.js"),
          type: "page",
          urlPattern: "/empty",
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("missing default export");
  });

  test("multiple SSG pages (static + dynamic) in same manifest", async () => {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});

    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "about.page.js"),
          type: "page",
          urlPattern: "/about",
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
        {
          filePath: join(tempDir, "routes", "blog", "[id].page.js"),
          type: "page",
          urlPattern: "/blog/:id",
          layouts: [],
          middlewares: [],
          params: ["id"],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    // 1 static + 3 dynamic = 4 total
    expect(result.pages).toBe(4);
    expect(result.paths).toContain("/about");
    expect(result.paths).toContain("/blog/1");
    expect(result.paths).toContain("/blog/2");
    expect(result.paths).toContain("/blog/3");
  });

  test("root '/' as SSG page → writes index.html at outputDir root", async () => {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});

    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "root.page.js"),
          type: "page",
          urlPattern: "/",
          layouts: [],
          middlewares: [],
          params: [],
          isCatchAll: false,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(1);
    expect(result.paths).toContain("/");

    const html = await readFile(join(outputDir, "index.html"), "utf-8");
    expect(html).toContain("</html>");
  });

  test("catch-all route uses actual param name (not hardcoded 'rest')", async () => {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});

    const manifest: RouteManifest = {
      routes: [
        {
          filePath: join(tempDir, "routes", "docs", "[...slug].page.js"),
          type: "page",
          urlPattern: "/docs/*",
          layouts: [],
          middlewares: [],
          params: ["slug"],
          isCatchAll: true,
        },
      ],
      scannedAt: new Date().toISOString(),
      rootDir: join(tempDir, "routes"),
    };

    const result = await buildStaticPages({
      rootDir: tempDir,
      outputDir,
      manifest,
    });

    expect(result.pages).toBe(2);
    expect(result.paths).toContain("/docs/intro");
    expect(result.paths).toContain("/docs/guide/setup");

    // Verify file output
    const html1 = await readFile(join(outputDir, "docs", "intro", "index.html"), "utf-8");
    expect(html1.length).toBeGreaterThan(0);
    const html2 = await readFile(join(outputDir, "docs", "guide", "setup", "index.html"), "utf-8");
    expect(html2.length).toBeGreaterThan(0);
  });
});
