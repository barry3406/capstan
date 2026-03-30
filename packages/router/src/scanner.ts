import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { RouteEntry, RouteManifest, RouteType } from "./types.js";

/**
 * Detect whether a page file is a server or client component by checking
 * for a "use client" directive at the top of the file.
 */
function detectComponentType(filePath: string): "server" | "client" {
  try {
    // Read only the first 100 bytes — enough to detect the directive
    const fd = readFileSync(filePath, { encoding: "utf-8", flag: "r" });
    const head = fd.slice(0, 100);
    const firstLine = head.split(/\r?\n/)[0]?.trim() ?? "";
    if (firstLine === '"use client"' || firstLine === "'use client'" || firstLine === '"use client";' || firstLine === "'use client';") {
      return "client";
    }
  } catch {
    // If we can't read the file, default to server
  }
  return "server";
}

/**
 * Determine the route type from a filename.
 * Returns null if the file is not a recognized route file.
 */
function classifyFile(filename: string): RouteType | null {
  if (filename === "_layout.tsx") return "layout";
  if (filename === "_middleware.ts") return "middleware";
  if (filename.endsWith(".page.tsx")) return "page";
  if (filename.endsWith(".api.ts")) return "api";
  return null;
}

/**
 * Convert a filename to its URL segment contribution.
 *
 *   index.page.tsx   -> "" (index routes map to the directory itself)
 *   about.page.tsx   -> "about"
 *   [id].page.tsx    -> ":id"
 *   [...rest].page.tsx -> "*"
 *   index.api.ts     -> ""
 *   [id].api.ts      -> ":id"
 */
function fileToSegment(filename: string): { segment: string; params: string[]; isCatchAll: boolean } {
  // Strip the suffix to get the base name
  let base: string;
  if (filename.endsWith(".page.tsx")) {
    base = filename.slice(0, -".page.tsx".length);
  } else if (filename.endsWith(".api.ts")) {
    base = filename.slice(0, -".api.ts".length);
  } else {
    return { segment: "", params: [], isCatchAll: false };
  }

  if (base === "index") {
    return { segment: "", params: [], isCatchAll: false };
  }

  // Catch-all: [...rest]
  const catchAllMatch = base.match(/^\[\.\.\.(\w+)\]$/);
  if (catchAllMatch) {
    return { segment: "*", params: [catchAllMatch[1]!], isCatchAll: true };
  }

  // Dynamic segment: [param]
  const dynamicMatch = base.match(/^\[(\w+)\]$/);
  if (dynamicMatch) {
    return { segment: `:${dynamicMatch[1]}`, params: [dynamicMatch[1]!], isCatchAll: false };
  }

  // Static segment
  return { segment: base, params: [], isCatchAll: false };
}

/**
 * Convert a directory path relative to the routes root into URL segments.
 * Each directory named as a dynamic segment (e.g. `[orgId]`) is converted.
 */
function dirToSegments(relativeDir: string): { segments: string[]; params: string[] } {
  if (relativeDir === "" || relativeDir === ".") {
    return { segments: [], params: [] };
  }

  const parts = relativeDir.split(path.sep);
  const segments: string[] = [];
  const params: string[] = [];

  for (const part of parts) {
    const catchAllMatch = part.match(/^\[\.\.\.(\w+)\]$/);
    if (catchAllMatch) {
      segments.push("*");
      params.push(catchAllMatch[1]!);
      continue;
    }

    const dynamicMatch = part.match(/^\[(\w+)\]$/);
    if (dynamicMatch) {
      segments.push(`:${dynamicMatch[1]}`);
      params.push(dynamicMatch[1]!);
      continue;
    }

    segments.push(part);
  }

  return { segments, params };
}

/**
 * Collect all _layout.tsx files from the routes root down to the given directory,
 * ordered from outermost to innermost.
 */
function collectLayouts(routesDir: string, relativeDir: string): string[] {
  const layouts: string[] = [];
  const parts = relativeDir === "" || relativeDir === "." ? [] : relativeDir.split(path.sep);

  // Check the root directory first
  layouts.push(path.join(routesDir, "_layout.tsx"));

  // Then each nested directory
  let current = routesDir;
  for (const part of parts) {
    current = path.join(current, part);
    layouts.push(path.join(current, "_layout.tsx"));
  }

  return layouts;
}

/**
 * Collect all _middleware.ts files from the routes root down to the given directory,
 * ordered from outermost to innermost.
 */
function collectMiddlewares(routesDir: string, relativeDir: string): string[] {
  const middlewares: string[] = [];
  const parts = relativeDir === "" || relativeDir === "." ? [] : relativeDir.split(path.sep);

  middlewares.push(path.join(routesDir, "_middleware.ts"));

  let current = routesDir;
  for (const part of parts) {
    current = path.join(current, part);
    middlewares.push(path.join(current, "_middleware.ts"));
  }

  return middlewares;
}

/**
 * Recursively walk a directory, returning all files as paths relative to the root.
 */
async function walkDir(dir: string, root: string): Promise<string[]> {
  const files: string[] = [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or can't be read
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkDir(fullPath, root);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(path.relative(root, fullPath));
    }
  }

  return files;
}

/**
 * Filter layout/middleware candidate paths to only those that actually exist as
 * files discovered during the scan.
 */
function filterExisting(candidates: string[], existingAbsolute: Set<string>): string[] {
  return candidates.filter((p) => existingAbsolute.has(p));
}

/**
 * Scan a routes directory and produce a RouteManifest describing every route file found.
 */
export async function scanRoutes(routesDir: string): Promise<RouteManifest> {
  const resolvedRoot = path.resolve(routesDir);

  // Verify the directory exists
  try {
    const s = await stat(resolvedRoot);
    if (!s.isDirectory()) {
      return {
        routes: [],
        scannedAt: new Date().toISOString(),
        rootDir: resolvedRoot,
      };
    }
  } catch {
    return {
      routes: [],
      scannedAt: new Date().toISOString(),
      rootDir: resolvedRoot,
    };
  }

  const relativePaths = await walkDir(resolvedRoot, resolvedRoot);

  // Build a set of all absolute paths for existence checks
  const absolutePathSet = new Set(relativePaths.map((rp) => path.join(resolvedRoot, rp)));

  const routes: RouteEntry[] = [];

  for (const relPath of relativePaths) {
    const filename = path.basename(relPath);
    const routeType = classifyFile(filename);

    if (routeType === null) {
      // Not a recognized route file — skip
      continue;
    }

    const relativeDir = path.dirname(relPath);
    const absoluteFilePath = path.join(resolvedRoot, relPath);

    // Build URL pattern
    const dirInfo = dirToSegments(relativeDir);

    if (routeType === "layout" || routeType === "middleware") {
      // Layouts and middlewares don't get their own URL pattern —
      // they are referenced by other routes. But we still include them
      // in the manifest so they can be discovered.
      const urlParts = dirInfo.segments;
      const urlPattern = "/" + urlParts.join("/");

      routes.push({
        filePath: absoluteFilePath,
        type: routeType,
        urlPattern: urlPattern === "/" ? "/" : urlPattern.replace(/\/$/, ""),
        layouts: [],
        middlewares: [],
        params: dirInfo.params,
        isCatchAll: false,
      });
      continue;
    }

    // Page or API route
    const fileInfo = fileToSegment(filename);
    const allParams = [...dirInfo.params, ...fileInfo.params];
    const urlParts = [...dirInfo.segments];
    if (fileInfo.segment !== "") {
      urlParts.push(fileInfo.segment);
    }

    const urlPattern = "/" + urlParts.join("/");

    // Collect parent layouts and middlewares (only those that actually exist on disk)
    const layoutCandidates = collectLayouts(resolvedRoot, relativeDir);
    const middlewareCandidates = collectMiddlewares(resolvedRoot, relativeDir);
    const layouts = filterExisting(layoutCandidates, absolutePathSet);
    const middlewares = filterExisting(middlewareCandidates, absolutePathSet);

    const entry: RouteEntry = {
      filePath: absoluteFilePath,
      type: routeType,
      urlPattern: urlPattern === "/" ? "/" : urlPattern.replace(/\/$/, ""),
      layouts,
      middlewares,
      params: allParams,
      isCatchAll: fileInfo.isCatchAll,
    };

    if (routeType === "api") {
      // API routes support all standard HTTP methods by default.
      // The actual exported methods are determined at runtime.
      entry.methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    }

    if (routeType === "page") {
      entry.componentType = detectComponentType(absoluteFilePath);
    }

    routes.push(entry);
  }

  // Sort for deterministic output:
  // 1. By URL pattern alphabetically
  // 2. By type (layout < middleware < page < api)
  // 3. By file path as tiebreaker
  const typeOrder: Record<RouteType, number> = {
    layout: 0,
    middleware: 1,
    page: 2,
    api: 3,
  };

  routes.sort((a, b) => {
    const patternCmp = a.urlPattern.localeCompare(b.urlPattern);
    if (patternCmp !== 0) return patternCmp;

    const typeCmp = typeOrder[a.type] - typeOrder[b.type];
    if (typeCmp !== 0) return typeCmp;

    return a.filePath.localeCompare(b.filePath);
  });

  return {
    routes,
    scannedAt: new Date().toISOString(),
    rootDir: resolvedRoot,
  };
}
