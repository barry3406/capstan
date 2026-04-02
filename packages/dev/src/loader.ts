import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";

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

/**
 * Monotonically increasing generation counter bumped on explicit cache
 * invalidation.  Appended to the import URL alongside the file mtime to
 * guarantee uniqueness even when rapid edits occur within the same
 * millisecond (e.g. editor auto-format on save).
 */
let cacheGeneration = 0;

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
  const fileStat = await stat(filePath);
  const cached = moduleCache.get(filePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.mod;
  }

  const fileUrl = pathToFileURL(filePath).href;
  const bustUrl = `${fileUrl}?t=${fileStat.mtimeMs}_${cacheGeneration}`;
  const mod = (await import(bustUrl)) as Record<string, unknown>;
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
    renderMode?: unknown;
    revalidate?: unknown;
    cacheTags?: unknown;
    metadata?: unknown;
    generateStaticParams?: unknown;
  } = {};

  if (mod["default"] !== undefined) result.default = mod["default"];
  if (mod["loader"] !== undefined) result.loader = mod["loader"];
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
}> {
  const mod = await loadRouteModule(filePath);

  const result: {
    default?: unknown;
  } = {};

  if (mod["default"] !== undefined) result.default = mod["default"];

  return result;
}
