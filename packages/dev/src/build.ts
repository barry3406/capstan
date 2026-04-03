import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { RouteManifest } from "@zauso-ai/capstan-router";

export interface BuildStaticOptions {
  /** Project root directory */
  rootDir: string;
  /** Output directory for pre-rendered files (default: dist/static) */
  outputDir: string;
  /** Route manifest from scanRoutes() — file paths should point to compiled .js */
  manifest: RouteManifest;
}

export interface BuildStaticResult {
  /** Number of pages successfully pre-rendered */
  pages: number;
  /** Pre-rendered URL paths */
  paths: string[];
  /** Errors encountered during rendering */
  errors: string[];
}

/**
 * Pre-render SSG pages at build time.
 *
 * For each page route with `renderMode === "ssg"`:
 * - Static routes (no params): render once
 * - Dynamic routes: call `generateStaticParams()` and render for each param set
 *
 * Output: HTML files in outputDir + `_ssg_manifest.json` listing all paths.
 */
export async function buildStaticPages(
  options: BuildStaticOptions,
): Promise<BuildStaticResult> {
  const { outputDir, manifest } = options;
  const result: BuildStaticResult = { pages: 0, paths: [], errors: [] };

  // Lazy-import @zauso-ai/capstan-react — may not be available in all contexts
  let renderPage: ((opts: Record<string, unknown>) => Promise<{ html: string; statusCode: number }>) | undefined;
  try {
    const reactPkg = await import("@zauso-ai/capstan-react");
    renderPage = reactPkg.renderPage as unknown as (opts: Record<string, unknown>) => Promise<{ html: string; statusCode: number }>;
  } catch {
    result.errors.push("Failed to import @zauso-ai/capstan-react — cannot pre-render SSG pages");
    return result;
  }

  const pageRoutes = manifest.routes.filter((r) => r.type === "page");

  for (const route of pageRoutes) {
    // Load the compiled page module
    let pageModule: Record<string, unknown>;
    try {
      pageModule = await import(pathToFileURL(route.filePath).href) as Record<string, unknown>;
    } catch (err) {
      result.errors.push(`Failed to import ${route.filePath}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Only process SSG pages
    if (pageModule["renderMode"] !== "ssg") continue;
    if (typeof pageModule["default"] !== "function") {
      result.errors.push(`${route.filePath}: SSG page missing default export`);
      continue;
    }

    // Load layouts
    const layouts: Array<{ default: unknown }> = [];
    for (const layoutPath of route.layouts) {
      try {
        const layoutMod = await import(pathToFileURL(layoutPath).href) as Record<string, unknown>;
        if (typeof layoutMod["default"] === "function") {
          layouts.push({ default: layoutMod["default"] });
        }
      } catch {
        // Layout load failure — skip but don't block
      }
    }

    // Load boundary components
    let loadingComponent: unknown;
    let errorComponent: unknown;
    if (route.loading) {
      try {
        const mod = await import(pathToFileURL(route.loading).href) as Record<string, unknown>;
        if (mod["default"]) loadingComponent = mod["default"];
      } catch { /* skip */ }
    }
    if (route.error) {
      try {
        const mod = await import(pathToFileURL(route.error).href) as Record<string, unknown>;
        if (mod["default"]) errorComponent = mod["default"];
      } catch { /* skip */ }
    }

    // Determine param sets to render
    const paramSets: Array<Record<string, string>> = [];
    const hasDynamicParams = route.params.length > 0;

    if (hasDynamicParams) {
      if (typeof pageModule["generateStaticParams"] !== "function") {
        result.errors.push(
          `${route.filePath}: SSG page with dynamic params must export generateStaticParams()`,
        );
        continue;
      }
      try {
        const generated = await (pageModule["generateStaticParams"] as () => Promise<unknown>)();
        if (Array.isArray(generated)) {
          for (const p of generated) {
            if (p && typeof p === "object") paramSets.push(p as Record<string, string>);
          }
        }
      } catch (err) {
        result.errors.push(
          `${route.filePath}: generateStaticParams() failed: ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }
    } else {
      // Static route — render once with empty params
      paramSets.push({});
    }

    // Render each param set
    for (const params of paramSets) {
      // Build the URL from the pattern + params
      let urlPath = route.urlPattern;
      for (const [key, value] of Object.entries(params)) {
        urlPath = urlPath.replace(`:${key}`, value);
      }
      // Catch-all: replace trailing * with the actual param value
      // (scanner names the param after the file, e.g. "slug" for [...slug])
      if (route.isCatchAll && route.params.length > 0) {
        const catchAllParam = route.params[route.params.length - 1]!;
        const catchAllValue = params[catchAllParam];
        if (catchAllValue) {
          urlPath = urlPath.replace("*", catchAllValue);
        }
      }

      const syntheticRequest = new Request(`http://localhost${urlPath}`);
      const loaderArgs = {
        params,
        request: syntheticRequest,
        ctx: { auth: { isAuthenticated: false, type: "anonymous" as const } },
        fetch: {
          get: async () => null,
          post: async () => null,
          put: async () => null,
          delete: async () => null,
        },
      };

      try {
        const rendered = await renderPage({
          pageModule: {
            default: pageModule["default"],
            loader: pageModule["loader"],
          },
          layouts,
          params,
          request: syntheticRequest,
          loaderArgs,
          loadingComponent,
          errorComponent,
        });

        // Write to filesystem
        const segments = urlPath.replace(/^\/+|\/+$/g, "");
        const filePath = segments === ""
          ? join(outputDir, "index.html")
          : join(outputDir, segments, "index.html");

        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, rendered.html, "utf-8");

        result.pages++;
        result.paths.push(urlPath === "" ? "/" : urlPath);
      } catch (err) {
        result.errors.push(
          `${route.filePath} (${urlPath}): render failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // Write SSG manifest
  if (result.paths.length > 0) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      join(outputDir, "_ssg_manifest.json"),
      JSON.stringify({ paths: result.paths, generatedAt: new Date().toISOString() }, null, 2),
    );
  }

  return result;
}
