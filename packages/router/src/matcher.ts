import type { MatchedRoute, RouteManifest } from "./types.js";

/**
 * Normalize a URL path by removing trailing slashes (except for root "/")
 * and collapsing repeated slashes.
 */
function normalizePath(urlPath: string): string {
  // Collapse repeated slashes
  let normalized = urlPath.replace(/\/+/g, "/");
  // Remove trailing slash (unless it IS the root)
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  // Ensure leading slash
  if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }
  return normalized;
}

/**
 * Attempt to match a URL path against a single route pattern.
 * Returns extracted params and a specificity score, or null if no match.
 *
 * Specificity is measured as the number of static segments — more static segments
 * means a more specific match. Catch-all routes get the lowest specificity.
 */
function tryMatch(
  pattern: string,
  urlPath: string,
): { params: Record<string, string>; specificity: number } | null {
  const patternParts = pattern === "/" ? [""] : pattern.split("/");
  const urlParts = urlPath === "/" ? [""] : urlPath.split("/");

  const params: Record<string, string> = {};
  let staticSegments = 0;

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i]!;

    // Catch-all: matches the rest of the URL
    if (patternPart === "*") {
      // Collect remaining URL segments (everything from this position onward)
      const rest = urlParts.slice(i).join("/");
      // For catch-all stored in params, we need the param name from the route.
      // We store under a generic key here; the caller maps it to the real name.
      params["*"] = rest;
      // Catch-all gets lowest specificity bonus
      return { params, specificity: staticSegments };
    }

    // If we've run out of URL segments but still have pattern segments, no match
    if (i >= urlParts.length) {
      return null;
    }

    const urlPart = urlParts[i]!;

    if (patternPart.startsWith(":")) {
      // Dynamic segment
      const paramName = patternPart.slice(1);
      params[paramName] = decodeURIComponent(urlPart);
    } else {
      // Static segment — must match exactly
      if (patternPart !== urlPart) {
        return null;
      }
      staticSegments++;
    }
  }

  // If there are remaining URL segments that weren't consumed, no match
  if (urlParts.length > patternParts.length) {
    return null;
  }

  return { params, specificity: staticSegments };
}

function matchesNotFoundScope(scopePattern: string, urlPath: string): boolean {
  if (scopePattern === "/") {
    return true;
  }

  return urlPath === scopePattern || urlPath.startsWith(`${scopePattern}/`);
}

function countVisibleSegments(urlPattern: string): number {
  return urlPattern.split("/").filter(Boolean).length;
}

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function countDirectoryDepth(manifest: RouteManifest, filePath: string): number {
  const normalizedRoot = normalizeFilePath(manifest.rootDir).replace(/\/+$/, "");
  const normalizedFile = normalizeFilePath(filePath);

  if (normalizedFile !== normalizedRoot && !normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return 0;
  }

  const relativePath = normalizedFile
    .slice(normalizedRoot.length)
    .replace(/^\/+/, "");
  const segments = relativePath.split("/").filter(Boolean);

  if (segments.length <= 1) {
    return 0;
  }

  return segments.slice(0, -1).length;
}

/**
 * Match a URL path and HTTP method against the route manifest.
 *
 * Returns the best matching route (most specific) along with extracted parameters,
 * or null if no route matches.
 *
 * Matching priority:
 * 1. Static segments are preferred over dynamic segments
 * 2. Dynamic segments are preferred over catch-all
 * 3. Page routes match any method (they serve GET by convention)
 * 4. API routes must match the given HTTP method
 */
export function matchRoute(
  manifest: RouteManifest,
  method: string,
  urlPath: string,
): MatchedRoute | null {
  const normalizedPath = normalizePath(urlPath);
  const upperMethod = method.toUpperCase();

  interface Candidate {
    match: MatchedRoute;
    specificity: number;
    isCatchAll: boolean;
  }

  let best: Candidate | null = null;

  for (const route of manifest.routes) {
    // Skip boundary/support entries during direct matching.
    if (
      route.type === "layout" ||
      route.type === "middleware" ||
      route.type === "loading" ||
      route.type === "error" ||
      route.type === "not-found"
    ) {
      continue;
    }

    // For API routes, check that the method is supported
    if (route.type === "api" && route.methods && !route.methods.includes(upperMethod)) {
      continue;
    }

    const result = tryMatch(route.urlPattern, normalizedPath);
    if (result === null) {
      continue;
    }

    // Resolve catch-all param name: replace the generic "*" key with the actual param name
    if ("*" in result.params && route.params.length > 0) {
      const catchAllParamName = route.params[route.params.length - 1]!;
      result.params[catchAllParamName] = result.params["*"]!;
      delete result.params["*"];
    }

    const candidate: Candidate = {
      match: { route, params: result.params },
      specificity: result.specificity,
      isCatchAll: route.isCatchAll,
    };

    if (best === null) {
      best = candidate;
      continue;
    }

    // Determine if this candidate is better than the current best.
    //
    // Priority order:
    // 1. Non-catch-all beats catch-all
    // 2. Higher specificity (more static segments) beats lower
    // 3. At equal specificity and catch-all status, prefer the route type
    //    that best matches the HTTP method:
    //    - For GET requests, prefer page routes over api routes
    //    - For non-GET requests, prefer api routes over page routes
    if (!candidate.isCatchAll && best.isCatchAll) {
      best = candidate;
    } else if (candidate.isCatchAll === best.isCatchAll) {
      if (candidate.specificity > best.specificity) {
        best = candidate;
      } else if (candidate.specificity === best.specificity) {
        const preferApi = upperMethod !== "GET";
        const candidateIsApi = candidate.match.route.type === "api";
        const bestIsApi = best.match.route.type === "api";
        if (preferApi && candidateIsApi && !bestIsApi) {
          best = candidate;
        } else if (!preferApi && !candidateIsApi && bestIsApi) {
          best = candidate;
        }
      }
    }
  }

  if (best !== null) {
    return best.match;
  }

  // not-found is a page fallback. Only apply it to GET/HEAD when no direct
  // route matched.
  if (upperMethod !== "GET" && upperMethod !== "HEAD") {
    return null;
  }

  let bestNotFound: RouteManifest["routes"][number] | null = null;
  let bestVisibleDepth = -1;
  let bestDirectoryDepth = -1;

  for (const route of manifest.routes) {
    if (route.type !== "not-found") {
      continue;
    }

    if (!matchesNotFoundScope(route.urlPattern, normalizedPath)) {
      continue;
    }

    const visibleDepth = countVisibleSegments(route.urlPattern);
    const directoryDepth = countDirectoryDepth(manifest, route.filePath);

    if (
      bestNotFound === null ||
      visibleDepth > bestVisibleDepth ||
      (visibleDepth === bestVisibleDepth && directoryDepth > bestDirectoryDepth) ||
      (
        visibleDepth === bestVisibleDepth &&
        directoryDepth === bestDirectoryDepth &&
        route.filePath.localeCompare(bestNotFound.filePath) < 0
      )
    ) {
      bestNotFound = route;
      bestVisibleDepth = visibleDepth;
      bestDirectoryDepth = directoryDepth;
    }
  }

  return bestNotFound ? { route: bestNotFound, params: {} } : null;
}
