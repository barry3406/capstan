import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createRouteScanCache,
  scanRoutes,
} from "@zauso-ai/capstan-router";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-route-scan-cache-"));
  tempDirs.push(dir);
  return dir;
}

async function touch(base: string, relativePath: string, content = ""): Promise<void> {
  const fullPath = join(base, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("route scan cache and static analysis", () => {
  it("reuses an unchanged manifest and invalidates descendants when an ancestor boundary changes", async () => {
    const dir = await makeTempDir();
    const cache = createRouteScanCache();

    await touch(dir, "_layout.tsx", "export default function Root({ children }) { return children; }");
    await touch(dir, "dashboard/_layout.tsx", "export default function Dashboard({ children }) { return children; }");
    await touch(dir, "dashboard/index.page.tsx", "export default function Page() { return null; }");

    const first = await scanRoutes(dir, { cache });
    const second = await scanRoutes(dir, { cache });
    const firstPage = first.routes.find((route) => route.type === "page" && route.urlPattern === "/dashboard");
    const secondPage = second.routes.find((route) => route.type === "page" && route.urlPattern === "/dashboard");

    expect(second).toBe(first);
    expect(secondPage).toBe(firstPage);

    await touch(
      dir,
      "dashboard/_layout.tsx",
      "export default function DashboardUpdated({ children }) { return children; }",
    );

    const third = await scanRoutes(dir, { cache });
    const thirdPage = third.routes.find((route) => route.type === "page" && route.urlPattern === "/dashboard");

    expect(third).not.toBe(first);
    expect(thirdPage).not.toBe(firstPage);
  });

  it("emits static analysis warnings for ignored boundary exports and dynamic ssg gaps", async () => {
    const dir = await makeTempDir();

    await touch(
      dir,
      "blog/[slug].page.tsx",
      [
        "export const renderMode = 'ssg';",
        "export const metadata = { title: 'Blog' };",
        "export default function BlogPage() { return null; }",
      ].join("\n"),
    );
    await touch(
      dir,
      "_loading.tsx",
      [
        "export const loader = async () => ({ ok: true });",
        "export default function Loading() { return null; }",
      ].join("\n"),
    );
    await touch(
      dir,
      "settings.page.tsx",
      [
        "export async function generateStaticParams() { return []; }",
        "export default function SettingsPage() { return null; }",
      ].join("\n"),
    );

    const manifest = await scanRoutes(dir);
    const messages = manifest.diagnostics?.map((diagnostic) => diagnostic.message) ?? [];
    const blogPage = manifest.routes.find((route) => route.type === "page" && route.urlPattern === "/blog/:slug");

    expect(messages.some((message) => message.includes("Dynamic SSG pages should export generateStaticParams"))).toBe(true);
    expect(messages.some((message) => message.includes("loading routes should not export loader"))).toBe(true);
    expect(messages.some((message) => message.includes("page without dynamic params"))).toBe(true);
    expect(blogPage?.staticInfo).toMatchObject({
      hasMetadata: true,
      renderMode: "ssg",
      exportNames: ["default", "metadata", "renderMode"],
    });
  });
});
