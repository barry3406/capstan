import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, stat, writeFile } from "node:fs/promises";

type EsbuildBuild = typeof import("esbuild").build;

/**
 * Cached module entry that tracks the file's mtime so we only re-evaluate
 * modules when the underlying file has actually changed on disk.
 */
interface CachedModule {
  mod: Record<string, unknown>;
  mtimeMs: number;
}

/**
 * Module cache keyed by absolute file path. Each entry stores the imported
 * module namespace and the mtime at the time of import. On subsequent calls
 * the file's current mtime is compared and the cache is reused when unchanged.
 */
const moduleCache = new Map<string, CachedModule>();
const virtualModuleRegistry = new Map<string, Record<string, unknown>>();

/**
 * Monotonically increasing generation counter bumped on explicit cache
 * invalidation.  Appended to the import URL alongside the file mtime to
 * guarantee uniqueness even when rapid edits occur within the same
 * millisecond (e.g. editor auto-format on save).
 */
let cacheGeneration = 0;
let esbuildBuild: EsbuildBuild | null = null;
const runtimeGlobals = globalThis as typeof globalThis & { Bun?: unknown };
let compiledRouteCacheRoot: string | null = null;

function isTypeScriptModule(filePath: string): boolean {
  return /\.(?:cts|mts|ts|tsx)$/.test(filePath);
}

async function findNearestTsconfig(filePath: string): Promise<string | undefined> {
  let currentDir = path.dirname(filePath);

  for (;;) {
    const candidate = path.join(currentDir, "tsconfig.json");
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) {
        return candidate;
      }
    } catch {
      // Keep walking upward.
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

async function getCompiledRouteCacheRoot(): Promise<string> {
  if (compiledRouteCacheRoot !== null) {
    return compiledRouteCacheRoot;
  }

  let currentDir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const nodeModulesDir = path.join(currentDir, "node_modules");
    try {
      const stats = await stat(nodeModulesDir);
      if (stats.isDirectory()) {
        compiledRouteCacheRoot = path.join(currentDir, ".capstan-route-cache");
        return compiledRouteCacheRoot;
      }
    } catch {
      // Keep walking upward.
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      compiledRouteCacheRoot = path.join(process.cwd(), ".capstan-route-cache");
      return compiledRouteCacheRoot;
    }
    currentDir = parentDir;
  }
}

async function getCompiledRoutePath(filePath: string, cacheKey: string): Promise<string> {
  const digest = createHash("sha256")
    .update(`${filePath}:${cacheKey}`)
    .digest("hex");

  return path.join(await getCompiledRouteCacheRoot(), `${digest}.mjs`);
}

async function importRouteFile(filePath: string, cacheKey: string): Promise<Record<string, unknown>> {
  if (isTypeScriptModule(filePath) && typeof runtimeGlobals.Bun === "undefined") {
    if (esbuildBuild === null) {
      ({ build: esbuildBuild } = await import("esbuild"));
    }

    const compiledPath = await getCompiledRoutePath(filePath, cacheKey);
    const tsconfig = await findNearestTsconfig(filePath);
    const result = await esbuildBuild({
      entryPoints: [filePath],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      write: false,
      jsx: "automatic",
      sourcemap: "inline",
      logLevel: "silent",
      packages: "external",
      ...(tsconfig ? { tsconfig } : {}),
    });

    const output = result.outputFiles[0];
    if (!output) {
      throw new Error(`Failed to compile route module: ${filePath}`);
    }

    await mkdir(path.dirname(compiledPath), { recursive: true });
    await writeFile(compiledPath, output.text, "utf-8");

    return (await import(pathToFileURL(compiledPath).href)) as Record<string, unknown>;
  }

  const fileUrl = pathToFileURL(filePath).href;
  const bustUrl = `${fileUrl}?t=${cacheKey}`;
  return (await import(bustUrl)) as Record<string, unknown>;
}

/**
 * Dynamically import a module from disk, using a mtime-based cache to avoid
 * redundant re-evaluation. The module is only re-imported when the file's
 * modification time has changed, which is critical for dev-server performance
 * while still supporting HMR-like behavior during development.
 *
 * Returns the full module namespace object.
 */
export async function loadRouteModule(
  filePath: string,
): Promise<Record<string, unknown>> {
  const virtualModule = virtualModuleRegistry.get(filePath);
  if (virtualModule) {
    return virtualModule;
  }

  const fileStat = await stat(filePath);
  const cached = moduleCache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.mod;
  }

  const mod = await importRouteFile(filePath, `${fileStat.mtimeMs}_${cacheGeneration}`);
  moduleCache.set(filePath, { mod, mtimeMs: fileStat.mtimeMs });
  return mod;
}

/**
 * Invalidate the module cache for a specific file path, or clear the entire
 * cache if no path is provided. Called by the file watcher when files change
 * so that the next `loadRouteModule()` call re-evaluates the module.
 */
export function invalidateModuleCache(filePath?: string): void {
  if (filePath) {
    moduleCache.delete(filePath);
  } else {
    moduleCache.clear();
  }
  // Bump generation so that a subsequent import of the same file with the
  // same mtime still gets a unique URL, avoiding stale Node ESM cache hits.
  cacheGeneration++;
}

export function registerVirtualRouteModule(
  filePath: string,
  mod: Record<string, unknown>,
): void {
  virtualModuleRegistry.set(filePath, mod);
}

export function registerVirtualRouteModules(
  modules: Record<string, Record<string, unknown>>,
): void {
  for (const [filePath, mod] of Object.entries(modules)) {
    virtualModuleRegistry.set(filePath, mod);
  }
}

export function clearVirtualRouteModules(filePath?: string): void {
  if (filePath) {
    virtualModuleRegistry.delete(filePath);
    return;
  }

  virtualModuleRegistry.clear();
}

/**
 * Import an API route file and extract the exported HTTP method handlers
 * and optional `meta` export.
 *
 * API route files are expected to export one or more of:
 *   GET, POST, PUT, DELETE, PATCH
 *
 * Each export should be the result of `defineAPI()` from @zauso-ai/capstan-core,
 * which produces an `APIDefinition` object with a `.handler` method.
 *
 * An optional `meta` export provides additional route metadata (e.g.
 * description, tags) that is merged into the agent manifest.
 */
export async function loadApiHandlers(filePath: string): Promise<{
  GET?: unknown;
  POST?: unknown;
  PUT?: unknown;
  DELETE?: unknown;
  PATCH?: unknown;
  meta?: Record<string, unknown>;
}> {
  const mod = await loadRouteModule(filePath);

  const result: {
    GET?: unknown;
    POST?: unknown;
    PUT?: unknown;
    DELETE?: unknown;
    PATCH?: unknown;
    meta?: Record<string, unknown>;
  } = {};

  if (mod["GET"] !== undefined) result.GET = mod["GET"];
  if (mod["POST"] !== undefined) result.POST = mod["POST"];
  if (mod["PUT"] !== undefined) result.PUT = mod["PUT"];
  if (mod["DELETE"] !== undefined) result.DELETE = mod["DELETE"];
  if (mod["PATCH"] !== undefined) result.PATCH = mod["PATCH"];

  if (mod["meta"] !== undefined && typeof mod["meta"] === "object") {
    result.meta = mod["meta"] as Record<string, unknown>;
  }

  return result;
}

/**
 * Import a page route file and extract the default component and
 * optional loader function.
 *
 * Page files are expected to export:
 *   - `default` -- a React component (the page itself)
 *   - `loader`  -- (optional) a server-side data-loading function
 */
export async function loadPageModule(filePath: string): Promise<{
  default?: unknown;
  loader?: unknown;
  hydration?: unknown;
  renderMode?: unknown;
  revalidate?: unknown;
  cacheTags?: unknown;
  metadata?: unknown;
  generateStaticParams?: unknown;
}> {
  const mod = await loadRouteModule(filePath);

  const result: {
    default?: unknown;
    loader?: unknown;
    hydration?: unknown;
    renderMode?: unknown;
    revalidate?: unknown;
    cacheTags?: unknown;
    metadata?: unknown;
    generateStaticParams?: unknown;
  } = {};

  if (mod["default"] !== undefined) result.default = mod["default"];
  if (mod["loader"] !== undefined) result.loader = mod["loader"];
  if (mod["hydration"] !== undefined) result.hydration = mod["hydration"];
  if (mod["renderMode"] !== undefined) result.renderMode = mod["renderMode"];
  if (mod["revalidate"] !== undefined) result.revalidate = mod["revalidate"];
  if (mod["cacheTags"] !== undefined) result.cacheTags = mod["cacheTags"];
  if (mod["metadata"] !== undefined) result.metadata = mod["metadata"];
  if (mod["generateStaticParams"] !== undefined) result.generateStaticParams = mod["generateStaticParams"];

  return result;
}

/**
 * Import a boundary file (_loading.tsx or _error.tsx) and extract its
 * default component export. Both file types have identical loading
 * semantics — the only difference is which React wrapper they end up in.
 */
async function loadBoundaryModule(filePath: string): Promise<{
  default?: unknown;
}> {
  const mod = await loadRouteModule(filePath);
  return mod["default"] !== undefined ? { default: mod["default"] } : {};
}

/** Import a _loading.tsx file and extract the default component. */
export const loadLoadingModule = loadBoundaryModule;

/** Import a _error.tsx file and extract the default component. */
export const loadErrorModule = loadBoundaryModule;

/**
 * Import a layout file and extract the default component.
 *
 * Layout files are expected to export:
 *   - `default` -- a React component that renders `<Outlet />` for child content
 */
export async function loadLayoutModule(filePath: string): Promise<{
  default?: unknown;
  metadata?: unknown;
}> {
  const mod = await loadRouteModule(filePath);

  const result: {
    default?: unknown;
    metadata?: unknown;
  } = {};

  if (mod["default"] !== undefined) result.default = mod["default"];
  if (mod["metadata"] !== undefined) result.metadata = mod["metadata"];

  return result;
}
