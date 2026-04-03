import { openSync, readSync, closeSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  RouteDiagnostic,
  RouteEntry,
  RouteManifest,
  RouteStaticInfo,
  RouteType,
} from "./types.js";
import {
  canonicalizeRouteManifest,
  createRouteConflictError as createValidationRouteConflictError,
} from "./validation.js";
import { analyzeRouteFileStaticInfo } from "./static-analysis.js";

function isRouteGroupSegment(segment: string): boolean {
  return /^\([^()/]+\)$/.test(segment);
}

function isNotFoundFile(filename: string): boolean {
  return filename === "not-found.tsx" || filename === "not-found.page.tsx";
}

interface ComponentTypeCacheEntry {
  signature: string;
  componentType: "server" | "client";
}

const componentTypeCache = new Map<string, ComponentTypeCacheEntry>();

interface RouteFileSnapshot {
  relativePath: string;
  absolutePath: string;
  filename: string;
  routeType: RouteType;
  signature: string;
}

interface CachedScannedRouteFile {
  signature: string;
  contextSignature: string;
  entry: RouteEntry;
  diagnostics: RouteDiagnostic[];
}

interface RouteScanCacheState {
  fileSignatures: Map<string, string>;
  scannedFiles: Map<string, CachedScannedRouteFile>;
  validationDiagnostics: RouteDiagnostic[];
  validationRouteOrder: string[];
  validationSignature: string;
  manifest: RouteManifest;
}

export class RouteScanCache {
  private states = new Map<string, RouteScanCacheState>();

  get(rootDir: string): RouteScanCacheState | undefined {
    return this.states.get(rootDir);
  }

  set(rootDir: string, state: RouteScanCacheState): void {
    this.states.set(rootDir, state);
  }

  clear(rootDir?: string): void {
    if (rootDir) {
      this.states.delete(path.resolve(rootDir));
      return;
    }

    this.states.clear();
  }
}

export interface ScanRoutesOptions {
  cache?: RouteScanCache;
}

export function createRouteScanCache(): RouteScanCache {
  return new RouteScanCache();
}

/**
 * Detect whether a page file is a server or client component by checking
 * for a "use client" directive at the top of the file.
 */
function detectComponentType(filePath: string): "server" | "client" {
  try {
    const stats = statSync(filePath);
    const signature = `${stats.mtimeMs}:${stats.size}`;
    const cached = componentTypeCache.get(filePath);
    if (cached?.signature === signature) {
      return cached.componentType;
    }
  } catch {
    componentTypeCache.delete(filePath);
    return "server";
  }

  // Read only the first 128 bytes — enough to detect "use client" directive
  // without pulling the entire file into memory.
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return "server";
  }
  try {
    const buf = Buffer.alloc(128);
    const bytesRead = readSync(fd, buf, 0, 128, 0);
    const head = buf.toString("utf-8", 0, bytesRead);
    const firstLine = head.split(/\r?\n/)[0]?.trim() ?? "";
    const componentType = (
      firstLine === '"use client"' ||
      firstLine === "'use client'" ||
      firstLine === '"use client";' ||
      firstLine === "'use client';"
    )
      ? "client"
      : "server";
    try {
      const stats = statSync(filePath);
      componentTypeCache.set(filePath, {
        signature: `${stats.mtimeMs}:${stats.size}`,
        componentType,
      });
    } catch {
      componentTypeCache.delete(filePath);
    }
    return componentType;
  } catch {
    componentTypeCache.delete(filePath);
    return "server";
  } finally {
    closeSync(fd);
  }
}

/**
 * Determine the route type from a filename.
 * Returns null if the file is not a recognized route file.
 */
function classifyFile(filename: string): RouteType | null {
  if (filename === "_layout.tsx") return "layout";
  if (filename === "_middleware.ts") return "middleware";
  if (filename === "_loading.tsx") return "loading";
  if (filename === "_error.tsx") return "error";
  if (isNotFoundFile(filename)) return "not-found";
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
 * Recursively walk a directory, returning all files as paths relative to the root.
 */
async function walkDir(dir: string): Promise<RouteFileSnapshot[]> {
  const files: RouteFileSnapshot[] = [];
  const stack: Array<{ absoluteDir: string; relativeDir: string }> = [
    { absoluteDir: dir, relativeDir: "." },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(current.absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current.absoluteDir, entry.name);
      const relativePath = current.relativeDir === "."
        ? entry.name
        : path.join(current.relativeDir, entry.name);

      if (entry.isDirectory()) {
        stack.push({
          absoluteDir: absolutePath,
          relativeDir: relativePath,
        });
        continue;
      }

      if (entry.isFile()) {
        const routeType = classifyFile(entry.name);
        if (!routeType) {
          continue;
        }

        try {
          const stats = statSync(absolutePath);
          files.push({
            relativePath,
            absolutePath,
            filename: entry.name,
            routeType,
            signature: `${stats.mtimeMs}:${stats.size}`,
          });
        } catch {
          continue;
        }
      }
    }
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

interface DirectoryRouteContext {
  dirInfo: {
    segments: string[];
    params: string[];
  };
  contextSignature: string;
  layouts: string[];
  middlewares: string[];
  nearestLoading?: string;
  nearestError?: string;
  nearestNotFound?: string;
}

function normalizeRelativeDir(relativeDir: string): string {
  return relativeDir === "" ? "." : relativeDir;
}

function getDirectoryDepth(relativeDir: string): number {
  if (relativeDir === "." || relativeDir === "") {
    return 0;
  }

  return relativeDir.split(path.sep).filter(Boolean).length;
}

function describeDirectorySegment(segment: string): { segments: string[]; params: string[] } {
  if (isRouteGroupSegment(segment)) {
    return { segments: [], params: [] };
  }

  const catchAllMatch = segment.match(/^\[\.\.\.(\w+)\]$/);
  if (catchAllMatch) {
    return { segments: ["*"], params: [catchAllMatch[1]!] };
  }

  const dynamicMatch = segment.match(/^\[(\w+)\]$/);
  if (dynamicMatch) {
    return { segments: [`:${dynamicMatch[1]}`], params: [dynamicMatch[1]!] };
  }

  return { segments: [segment], params: [] };
}

function resolveDirectoryFile(
  rootDir: string,
  relativeDir: string,
  filename: string,
  existingAbsolute: Set<string>,
): string | undefined {
  const absolutePath = path.join(rootDir, relativeDir === "." ? "" : relativeDir, filename);
  return existingAbsolute.has(absolutePath) ? absolutePath : undefined;
}

function buildDirectoryContexts(
  rootDir: string,
  routeFiles: readonly RouteFileSnapshot[],
  existingAbsolute: Set<string>,
): Map<string, DirectoryRouteContext> {
  const uniqueDirs = new Set<string>(["."]);
  const signatureByPath = new Map(routeFiles.map((file) => [file.relativePath, file.signature] as const));

  for (const { relativePath } of routeFiles) {
    let currentDir = normalizeRelativeDir(path.dirname(relativePath));
    for (;;) {
      uniqueDirs.add(currentDir);
      if (currentDir === ".") {
        break;
      }
      currentDir = normalizeRelativeDir(path.dirname(currentDir));
    }
  }

  const orderedDirs = [...uniqueDirs].sort((left, right) => {
    const depthCmp = getDirectoryDepth(left) - getDirectoryDepth(right);
    if (depthCmp !== 0) {
      return depthCmp;
    }
    return left.localeCompare(right);
  });

  const contexts = new Map<string, DirectoryRouteContext>();

  for (const relativeDir of orderedDirs) {
    const parentDir = relativeDir === "."
      ? null
      : normalizeRelativeDir(path.dirname(relativeDir));
    const parent = parentDir ? contexts.get(parentDir) : undefined;

    const dirInfo = (() => {
      if (!parent || relativeDir === ".") {
        return { segments: [] as string[], params: [] as string[] };
      }

      const segmentInfo = describeDirectorySegment(path.basename(relativeDir));
      return {
        segments: [...parent.dirInfo.segments, ...segmentInfo.segments],
        params: [...parent.dirInfo.params, ...segmentInfo.params],
      };
    })();

    const layoutPath = resolveDirectoryFile(rootDir, relativeDir, "_layout.tsx", existingAbsolute);
    const middlewarePath = resolveDirectoryFile(rootDir, relativeDir, "_middleware.ts", existingAbsolute);
    const loadingPath = resolveDirectoryFile(rootDir, relativeDir, "_loading.tsx", existingAbsolute);
    const errorPath = resolveDirectoryFile(rootDir, relativeDir, "_error.tsx", existingAbsolute);
    const notFoundPath = resolveDirectoryFile(rootDir, relativeDir, "not-found.tsx", existingAbsolute)
      ?? resolveDirectoryFile(rootDir, relativeDir, "not-found.page.tsx", existingAbsolute);
    const contextSignatureParts = [
      parent?.contextSignature ?? "root",
      relativeDir,
      dirInfo.segments.join(","),
      dirInfo.params.join(","),
      layoutPath ? `${normalizeRelativeDir(path.relative(rootDir, layoutPath))}@${signatureByPath.get(normalizeRelativeDir(path.relative(rootDir, layoutPath))) ?? "missing"}` : "layout:none",
      middlewarePath ? `${normalizeRelativeDir(path.relative(rootDir, middlewarePath))}@${signatureByPath.get(normalizeRelativeDir(path.relative(rootDir, middlewarePath))) ?? "missing"}` : "middleware:none",
      loadingPath ? `${normalizeRelativeDir(path.relative(rootDir, loadingPath))}@${signatureByPath.get(normalizeRelativeDir(path.relative(rootDir, loadingPath))) ?? "missing"}` : "loading:none",
      errorPath ? `${normalizeRelativeDir(path.relative(rootDir, errorPath))}@${signatureByPath.get(normalizeRelativeDir(path.relative(rootDir, errorPath))) ?? "missing"}` : "error:none",
      notFoundPath ? `${normalizeRelativeDir(path.relative(rootDir, notFoundPath))}@${signatureByPath.get(normalizeRelativeDir(path.relative(rootDir, notFoundPath))) ?? "missing"}` : "not-found:none",
    ];

    contexts.set(relativeDir, {
      dirInfo,
      contextSignature: contextSignatureParts.join("|"),
      layouts: layoutPath ? [...(parent?.layouts ?? []), layoutPath] : [...(parent?.layouts ?? [])],
      middlewares: middlewarePath
        ? [...(parent?.middlewares ?? []), middlewarePath]
        : [...(parent?.middlewares ?? [])],
      ...(loadingPath
        ? { nearestLoading: loadingPath }
        : parent?.nearestLoading
          ? { nearestLoading: parent.nearestLoading }
          : {}),
      ...(errorPath
        ? { nearestError: errorPath }
        : parent?.nearestError
          ? { nearestError: parent.nearestError }
          : {}),
      ...(notFoundPath
        ? { nearestNotFound: notFoundPath }
        : parent?.nearestNotFound
          ? { nearestNotFound: parent.nearestNotFound }
          : {}),
    });
  }

  return contexts;
}

function buildCachedManifest(
  manifest: RouteManifest,
  routeFiles: readonly RouteFileSnapshot[],
  scannedFiles: Map<string, CachedScannedRouteFile>,
  validationSignature: string,
  validationRouteOrder: string[],
  validationDiagnostics: RouteDiagnostic[],
): RouteScanCacheState {
  return {
    fileSignatures: new Map(routeFiles.map((file) => [file.relativePath, file.signature] as const)),
    scannedFiles,
    validationDiagnostics,
    validationRouteOrder,
    validationSignature,
    manifest,
  };
}

function snapshotsMatchCacheState(
  routeFiles: readonly RouteFileSnapshot[],
  cachedState: RouteScanCacheState,
): boolean {
  if (routeFiles.length !== cachedState.fileSignatures.size) {
    return false;
  }

  for (const file of routeFiles) {
    if (cachedState.fileSignatures.get(file.relativePath) !== file.signature) {
      return false;
    }
  }

  return true;
}

function buildStaticDiagnostics(
  filePath: string,
  routeType: RouteType,
  urlPattern: string,
  params: readonly string[],
): {
  staticInfo?: RouteStaticInfo;
  diagnostics: RouteDiagnostic[];
} {
  return analyzeRouteFileStaticInfo(
    filePath,
    routeType,
    urlPattern,
    params.length > 0,
  );
}

function createRouteValidationKey(route: RouteEntry): string {
  return `${route.type}:${route.filePath}`;
}

function createRouteValidationSignature(route: RouteEntry): string {
  return [
    route.type,
    route.filePath,
    route.urlPattern,
    route.params.join(","),
    route.isCatchAll ? "1" : "0",
    route.methods?.join(",") ?? "",
    route.layouts.join(","),
    route.middlewares.join(","),
    route.loading ?? "",
    route.error ?? "",
    route.notFound ?? "",
  ].join("|");
}

/**
 * Scan a routes directory and produce a RouteManifest describing every route file found.
 */
export async function scanRoutes(
  routesDir: string,
  options: ScanRoutesOptions = {},
): Promise<RouteManifest> {
  const resolvedRoot = path.resolve(routesDir);

  // Verify the directory exists
  try {
    const s = await stat(resolvedRoot);
    if (!s.isDirectory()) {
      return {
        routes: [],
        diagnostics: [],
        scannedAt: new Date().toISOString(),
        rootDir: resolvedRoot,
      };
    }
  } catch {
    return {
      routes: [],
      diagnostics: [],
      scannedAt: new Date().toISOString(),
      rootDir: resolvedRoot,
    };
  }

  const routeFiles = await walkDir(resolvedRoot);
  const cachedState = options.cache?.get(resolvedRoot);
  if (cachedState && snapshotsMatchCacheState(routeFiles, cachedState)) {
    return cachedState.manifest;
  }

  // Build a set of all absolute paths for existence checks
  const absolutePathSet = new Set(routeFiles.map((file) => file.absolutePath));
  const directoryContexts = buildDirectoryContexts(resolvedRoot, routeFiles, absolutePathSet);

  const routes: RouteEntry[] = [];
  const staticDiagnostics: RouteDiagnostic[] = [];
  const scannedFiles = new Map<string, CachedScannedRouteFile>();

  for (const routeFile of routeFiles) {
    const relativeDir = path.dirname(routeFile.relativePath);
    const absoluteFilePath = routeFile.absolutePath;
    const directoryContext = directoryContexts.get(normalizeRelativeDir(relativeDir));
    if (!directoryContext) {
      throw new Error(`Missing scanner directory context for ${relativeDir}`);
    }
    const cached = cachedState?.scannedFiles.get(routeFile.relativePath);
    if (cached && cached.signature === routeFile.signature && cached.contextSignature === directoryContext.contextSignature) {
      routes.push(cached.entry);
      staticDiagnostics.push(...cached.diagnostics);
      scannedFiles.set(routeFile.relativePath, cached);
      continue;
    }

    // Build URL pattern
    const { dirInfo } = directoryContext;
    const routeType = routeFile.routeType;

    if (
      routeType === "layout" ||
      routeType === "middleware" ||
      routeType === "loading" ||
      routeType === "error"
    ) {
      // Layouts and middlewares don't get their own URL pattern —
      // they are referenced by other routes. But we still include them
      // in the manifest so they can be discovered.
      const urlParts = dirInfo.segments;
      const urlPattern = "/" + urlParts.join("/");

      const entry: RouteEntry = {
        filePath: absoluteFilePath,
        type: routeType,
        urlPattern: urlPattern === "/" ? "/" : urlPattern.replace(/\/$/, ""),
        layouts: [],
        middlewares: [],
        params: dirInfo.params,
        isCatchAll: false,
      };
      const staticInfo = buildStaticDiagnostics(absoluteFilePath, routeType, entry.urlPattern, entry.params);
      if (staticInfo.staticInfo) {
        entry.staticInfo = staticInfo.staticInfo;
      }
      staticDiagnostics.push(...staticInfo.diagnostics);

      routes.push(entry);
      scannedFiles.set(routeFile.relativePath, {
        signature: routeFile.signature,
        contextSignature: directoryContext.contextSignature,
        entry,
        diagnostics: staticInfo.diagnostics,
      });
      continue;
    }

    if (routeType === "not-found") {
      const urlPattern = "/" + dirInfo.segments.join("/");
      const entry: RouteEntry = {
        filePath: absoluteFilePath,
        type: routeType,
        urlPattern: urlPattern === "/" ? "/" : urlPattern.replace(/\/$/, ""),
        layouts: directoryContext.layouts,
        middlewares: directoryContext.middlewares,
        params: dirInfo.params,
        isCatchAll: false,
        componentType: detectComponentType(absoluteFilePath),
      };
      const staticInfo = buildStaticDiagnostics(absoluteFilePath, routeType, entry.urlPattern, entry.params);
      if (staticInfo.staticInfo) entry.staticInfo = staticInfo.staticInfo;
      staticDiagnostics.push(...staticInfo.diagnostics);

      if (directoryContext.nearestLoading) entry.loading = directoryContext.nearestLoading;
      if (directoryContext.nearestError) entry.error = directoryContext.nearestError;
      if (directoryContext.nearestNotFound) entry.notFound = directoryContext.nearestNotFound;

      routes.push(entry);
      scannedFiles.set(routeFile.relativePath, {
        signature: routeFile.signature,
        contextSignature: directoryContext.contextSignature,
        entry,
        diagnostics: staticInfo.diagnostics,
      });
      continue;
    }

    // Page or API route
    const fileInfo = fileToSegment(routeFile.filename);
    const allParams = [...dirInfo.params, ...fileInfo.params];
    const urlParts = [...dirInfo.segments];
    if (fileInfo.segment !== "") {
      urlParts.push(fileInfo.segment);
    }

    const urlPattern = "/" + urlParts.join("/");

    const entry: RouteEntry = {
      filePath: absoluteFilePath,
      type: routeType,
      urlPattern: urlPattern === "/" ? "/" : urlPattern.replace(/\/$/, ""),
      layouts: directoryContext.layouts,
      middlewares: directoryContext.middlewares,
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
      if (directoryContext.nearestLoading) entry.loading = directoryContext.nearestLoading;
      if (directoryContext.nearestError) entry.error = directoryContext.nearestError;
      if (directoryContext.nearestNotFound) entry.notFound = directoryContext.nearestNotFound;
    }
    const staticInfo = buildStaticDiagnostics(absoluteFilePath, routeType, entry.urlPattern, entry.params);
    if (staticInfo.staticInfo) {
      entry.staticInfo = staticInfo.staticInfo;
    }
    staticDiagnostics.push(...staticInfo.diagnostics);

    routes.push(entry);
    scannedFiles.set(routeFile.relativePath, {
      signature: routeFile.signature,
      contextSignature: directoryContext.contextSignature,
      entry,
      diagnostics: staticInfo.diagnostics,
    });
  }

  const validationSignature = routes
    .map((route) => createRouteValidationSignature(route))
    .join("\n");
  const routeByValidationKey = new Map(
    routes.map((route) => [createRouteValidationKey(route), route] as const),
  );

  const reusedValidatedRoutes = cachedState && cachedState.validationSignature === validationSignature
    ? cachedState.validationRouteOrder
      .map((key) => routeByValidationKey.get(key))
      .filter((route): route is RouteEntry => route !== undefined)
    : undefined;
  const validated = reusedValidatedRoutes && reusedValidatedRoutes.length === routes.length
    ? {
        routes: reusedValidatedRoutes,
        diagnostics: cachedState!.validationDiagnostics,
      }
    : canonicalizeRouteManifest(routes, resolvedRoot);
  const diagnostics = [...validated.diagnostics, ...staticDiagnostics];
  const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errorDiagnostics.length > 0) {
    throw createValidationRouteConflictError(errorDiagnostics);
  }

  const manifest = {
    routes: validated.routes,
    diagnostics,
    scannedAt: new Date().toISOString(),
    rootDir: resolvedRoot,
  };
  options.cache?.set(
    resolvedRoot,
    buildCachedManifest(
      manifest,
      routeFiles,
      scannedFiles,
      validationSignature,
      validated.routes.map((route) => createRouteValidationKey(route)),
      validated.diagnostics,
    ),
  );
  return manifest;
}
