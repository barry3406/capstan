import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import { buildPortableRuntimeApp } from "../../packages/dev/src/runtime.js";
import type { RouteManifest } from "@zauso-ai/capstan-router/runtime";

function makeManifest(routeFilePath: string): RouteManifest {
  return {
    rootDir: "/workspace",
    scannedAt: new Date().toISOString(),
    routes: [
      {
        filePath: routeFilePath,
        type: "page",
        urlPattern: "/portal",
        layouts: [],
        middlewares: [],
        params: [],
        isCatchAll: false,
        componentType: "client",
      },
    ],
  };
}

describe("portable runtime diagnostics", () => {
  it("reports route validation signals and runtime render fallbacks", async () => {
    const routeFilePath = "/workspace/routes/portal.page.tsx";
    const manifest = makeManifest(routeFilePath);

    const build = await buildPortableRuntimeApp({
      rootDir: "/workspace",
      manifest,
      routeModules: {
        [routeFilePath]: {
          default: () => createElement("main", null, "Portable runtime"),
          componentType: "server",
          renderMode: "ssg",
        },
      },
    });

    const response = await build.app.fetch(new Request("http://localhost/portal?draft=1"));
    const html = await response.text();
    const diagnosticsHeader = response.headers.get("x-capstan-diagnostics");

    expect(response.status).toBe(200);
    expect(html).toContain("Portable runtime");
    expect(diagnosticsHeader).toBeTruthy();

    const diagnostics = JSON.parse(diagnosticsHeader ?? "[]") as Array<{ code: string }>;
    expect(diagnostics.some((diag) => diag.code === "route.component-type.scanned")).toBe(true);
    expect(diagnostics.some((diag) => diag.code === "page-runtime.render-mode-fallback")).toBe(true);
    expect(diagnostics.some((diag) => diag.code === "page-runtime.request")).toBe(true);
  });
});
