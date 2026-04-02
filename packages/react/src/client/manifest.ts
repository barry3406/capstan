import type { ClientRouteEntry } from "./types.js";

/**
 * Route manifest injected into full-page HTML responses as
 * `window.__CAPSTAN_MANIFEST__`.  The client router reads this at
 * bootstrap to know which routes exist and their component types.
 */
export interface ClientRouteManifest {
  routes: ClientRouteEntry[];
}

declare global {
  interface Window {
    __CAPSTAN_MANIFEST__?: ClientRouteManifest;
  }
}

/**
 * Read the route manifest from the global window object.
 * Returns `null` if the manifest was not injected (e.g. during SSR
 * or in a non-browser environment).
 */
export function getManifest(): ClientRouteManifest | null {
  if (typeof window === "undefined") return null;
  return window.__CAPSTAN_MANIFEST__ ?? null;
}

/**
 * Match a URL path against the manifest's route patterns.
 * Returns the matching route entry and extracted params, or null.
 */
export function matchRoute(
  manifest: ClientRouteManifest,
  pathname: string,
): { route: ClientRouteEntry; params: Record<string, string> } | null {
  for (const route of manifest.routes) {
    const match = matchPattern(route.urlPattern, pathname);
    if (match) return { route, params: match };
  }
  return null;
}

/**
 * Match a URL pattern (e.g. "/posts/:id") against a pathname.
 * Returns extracted params on match, or null.
 */
function matchPattern(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);

  // Catch-all: pattern ending with * matches everything
  const hasCatchAll = patternParts.at(-1) === "*";

  if (!hasCatchAll && patternParts.length !== pathParts.length) {
    return null;
  }

  if (hasCatchAll && pathParts.length < patternParts.length - 1) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pat = patternParts[i]!;

    if (pat === "*") {
      // Catch-all collects the rest
      params["*"] = pathParts.slice(i).join("/");
      return params;
    }

    if (pat.startsWith(":")) {
      params[pat.slice(1)] = pathParts[i]!;
      continue;
    }

    if (pat !== pathParts[i]) return null;
  }

  return params;
}

/**
 * Find the deepest shared layout between two routes.
 * Returns the layout key (path) or "/" if no layouts are shared.
 */
export function findSharedLayout(
  from: ClientRouteEntry | undefined,
  to: ClientRouteEntry,
): string {
  if (!from) return "/";

  const fromLayouts = from.layouts;
  const toLayouts = to.layouts;
  let shared = "/";

  for (let i = 0; i < Math.min(fromLayouts.length, toLayouts.length); i++) {
    if (fromLayouts[i] === toLayouts[i]) {
      shared = fromLayouts[i]!;
    } else {
      break;
    }
  }

  return shared;
}
