import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { scanRoutes } from "@zauso-ai/capstan-router";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-router-validation-"));
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

describe("router manifest validation", () => {
  it("canonicalizes direct route priority and exposes empty diagnostics", async () => {
    const dir = await makeTempDir();
    await touch(dir, "tickets/[id].page.tsx");
    await touch(dir, "tickets/new.page.tsx");
    await touch(dir, "tickets/[id].api.ts");

    const manifest = await scanRoutes(dir);

    expect(manifest.diagnostics).toEqual([]);
    expect(
      manifest.routes.filter((route) => route.type === "page").map((route) => route.urlPattern),
    ).toEqual(["/tickets/new", "/tickets/:id"]);
    expect(manifest.routes[0]?.type).toBe("page");
    expect(manifest.routes[0]?.urlPattern).toBe("/tickets/new");
  });

  it("reports overlapping same-priority routes as machine-readable diagnostics", async () => {
    const dir = await makeTempDir();
    await touch(dir, "a/[id]/c.page.tsx");
    await touch(dir, "a/b/[slug].page.tsx");

    try {
      await scanRoutes(dir);
      throw new Error("expected scanRoutes to reject");
    } catch (error) {
      expect(error).toMatchObject({ code: "ROUTE_CONFLICT" });
      const routeError = error as {
        conflicts: Array<{ reason: string; filePaths: string[] }>;
        diagnostics: Array<{ code: string; filePaths: string[] }>;
      };
      expect(routeError.conflicts[0]?.reason).toBe("ambiguous-route");
      expect(routeError.diagnostics[0]?.code).toBe("ambiguous-route");
      expect(routeError.diagnostics[0]?.filePaths).toEqual([
        join(dir, "a", "[id]", "c.page.tsx"),
        join(dir, "a", "b", "[slug].page.tsx"),
      ]);
    }
  });

  it("rejects catch-all routes that are not terminal", async () => {
    const dir = await makeTempDir();
    await touch(dir, "[...rest]/tail.page.tsx");

    try {
      await scanRoutes(dir);
      throw new Error("expected scanRoutes to reject");
    } catch (error) {
      expect(error).toMatchObject({ code: "ROUTE_CONFLICT" });
      const routeError = error as {
        conflicts: Array<{ reason: string; filePaths: string[] }>;
        diagnostics: Array<{ code: string; filePaths: string[] }>;
      };
      expect(routeError.conflicts[0]?.reason).toBe("invalid-route-pattern");
      expect(routeError.diagnostics[0]?.code).toBe("invalid-route-pattern");
      expect(routeError.diagnostics[0]?.filePaths).toEqual([
        join(dir, "[...rest]", "tail.page.tsx"),
      ]);
    }
  });
});
