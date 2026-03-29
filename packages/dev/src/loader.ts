import { pathToFileURL } from "node:url";

/**
 * Monotonically increasing counter used to bust Node's ESM module cache.
 * Each call to `loadRouteModule` gets a unique query string so that the
 * runtime always re-evaluates the file -- critical for HMR-like behavior
 * during development.
 */
let cacheBustCounter = 0;

/**
 * Dynamically import a module from disk, bypassing Node's module cache
 * by appending a unique query parameter to the file URL.
 *
 * Returns the full module namespace object.
 */
export async function loadRouteModule(
  filePath: string,
): Promise<Record<string, unknown>> {
  const fileUrl = pathToFileURL(filePath).href;
  const bustUrl = `${fileUrl}?t=${Date.now()}_${cacheBustCounter++}`;

  const mod = (await import(bustUrl)) as Record<string, unknown>;
  return mod;
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
}> {
  const mod = await loadRouteModule(filePath);

  const result: {
    default?: unknown;
    loader?: unknown;
  } = {};

  if (mod["default"] !== undefined) result.default = mod["default"];
  if (mod["loader"] !== undefined) result.loader = mod["loader"];

  return result;
}
