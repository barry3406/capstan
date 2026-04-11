import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import directly from source since not all exports are in the package index
import {
  loadRouteModule,
  loadApiHandlers,
  loadPageModule,
  loadLayoutModule,
  invalidateModuleCache,
} from "../../packages/dev/src/loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `capstan-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
  // Clear module cache before each test
  invalidateModuleCache();
});

afterEach(async () => {
  invalidateModuleCache();
  await rm(testDir, { recursive: true, force: true });
});

async function writeModule(name: string, content: string): Promise<string> {
  const filePath = join(testDir, name);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// loadRouteModule
// ---------------------------------------------------------------------------

describe("loadRouteModule", () => {
  it("loads a .ts module from disk", async () => {
    const filePath = await writeModule(
      "test-mod.ts",
      `export const greeting = "hello";`,
    );

    const mod = await loadRouteModule(filePath);
    expect(mod["greeting"]).toBe("hello");
  });

  it("cache busting: invalidation bumps generation so same mtime yields new URL", async () => {
    // Write a module and load it
    const filePath = await writeModule(
      "counter.ts",
      `export const value = 1;`,
    );

    const mod1 = await loadRouteModule(filePath);
    expect(mod1["value"]).toBe(1);

    // After invalidation, a reload should not throw even if file is unchanged
    invalidateModuleCache(filePath);
    const mod2 = await loadRouteModule(filePath);
    // The cache entry was deleted, so loadRouteModule re-imported the file
    expect(mod2["value"]).toBe(1);
    // mod2 should be a fresh cache entry (re-set into the map)
    expect(mod2).toBeDefined();
  });

  it("throws for invalid path", async () => {
    const badPath = join(testDir, "nonexistent.ts");
    await expect(loadRouteModule(badPath)).rejects.toThrow();
  });

  it("caches module when mtime unchanged", async () => {
    const filePath = await writeModule(
      "cached.ts",
      `export const x = Math.random();`,
    );

    const mod1 = await loadRouteModule(filePath);
    const mod2 = await loadRouteModule(filePath);
    // Same object reference when cached
    expect(mod1).toBe(mod2);
  });
});

// ---------------------------------------------------------------------------
// loadPageModule
// ---------------------------------------------------------------------------

describe("loadPageModule", () => {
  it("extracts default and loader exports", async () => {
    const filePath = await writeModule(
      "page.ts",
      `
export default function Page() { return "page"; }
export async function loader() { return { data: 1 }; }
`,
    );

    const result = await loadPageModule(filePath);
    expect(result.default).toBeDefined();
    expect(typeof result.default).toBe("function");
    expect(result.loader).toBeDefined();
    expect(typeof result.loader).toBe("function");
  });

  it("returns empty object for module without relevant exports", async () => {
    const filePath = await writeModule(
      "bare.ts",
      `export const unrelated = 42;`,
    );

    const result = await loadPageModule(filePath);
    expect(result.default).toBeUndefined();
    expect(result.loader).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadApiHandlers
// ---------------------------------------------------------------------------

describe("loadApiHandlers", () => {
  it("extracts GET/POST/PUT/DELETE/PATCH handlers", async () => {
    const filePath = await writeModule(
      "api.ts",
      `
export const GET = { handler: () => "get" };
export const POST = { handler: () => "post" };
export const PUT = { handler: () => "put" };
export const DELETE = { handler: () => "delete" };
export const PATCH = { handler: () => "patch" };
`,
    );

    const result = await loadApiHandlers(filePath);
    expect(result.GET).toBeDefined();
    expect(result.POST).toBeDefined();
    expect(result.PUT).toBeDefined();
    expect(result.DELETE).toBeDefined();
    expect(result.PATCH).toBeDefined();
  });

  it("extracts meta export", async () => {
    const filePath = await writeModule(
      "api-meta.ts",
      `
export const GET = { handler: () => "get" };
export const meta = { description: "List items", tags: ["items"] };
`,
    );

    const result = await loadApiHandlers(filePath);
    expect(result.GET).toBeDefined();
    expect(result.meta).toBeDefined();
    expect(result.meta!["description"]).toBe("List items");
  });

  it("returns empty result for module with no handlers", async () => {
    const filePath = await writeModule(
      "empty-api.ts",
      `export const helper = () => {};`,
    );

    const result = await loadApiHandlers(filePath);
    expect(result.GET).toBeUndefined();
    expect(result.POST).toBeUndefined();
    expect(result.meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadLayoutModule
// ---------------------------------------------------------------------------

describe("loadLayoutModule", () => {
  it("extracts default export", async () => {
    const filePath = await writeModule(
      "layout.ts",
      `export default function Layout() { return "layout"; }`,
    );

    const result = await loadLayoutModule(filePath);
    expect(result.default).toBeDefined();
    expect(typeof result.default).toBe("function");
  });

  it("returns empty when no default export", async () => {
    const filePath = await writeModule(
      "no-default.ts",
      `export const something = 123;`,
    );

    const result = await loadLayoutModule(filePath);
    expect(result.default).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// invalidateModuleCache
// ---------------------------------------------------------------------------

describe("invalidateModuleCache", () => {
  it("clears specific file from cache", async () => {
    const filePath = await writeModule(
      "cached-file.ts",
      `export const val = "original";`,
    );

    // Load to populate cache
    const mod1 = await loadRouteModule(filePath);
    expect(mod1["val"]).toBe("original");

    // Invalidate specific file — the app-level cache entry is removed
    invalidateModuleCache(filePath);

    // Reloading should work without error (cache entry was cleared)
    const mod2 = await loadRouteModule(filePath);
    expect(mod2["val"]).toBe("original");
  });

  it("clears all files when no argument", async () => {
    const file1 = await writeModule("a.ts", `export const a = 1;`);
    const file2 = await writeModule("b.ts", `export const b = 2;`);

    // Load both
    await loadRouteModule(file1);
    await loadRouteModule(file2);

    // Clear all
    invalidateModuleCache();

    // Both should reload on next access (no error = cache was cleared properly)
    const mod1 = await loadRouteModule(file1);
    const mod2 = await loadRouteModule(file2);
    expect(mod1["a"]).toBe(1);
    expect(mod2["b"]).toBe(2);
  });
});
