import type { RouteManifest } from "./types.js";

export interface AgentApiRoute {
  method: string;
  path: string;
  filePath: string;
}

/**
 * Extract API route information from a full RouteManifest for use by the
 * agent surface layer. Each API route is expanded into one entry per HTTP method.
 */
export function generateRouteManifest(
  manifest: RouteManifest,
): { apiRoutes: AgentApiRoute[] } {
  const apiRoutes: AgentApiRoute[] = [];

  for (const route of manifest.routes) {
    if (route.type !== "api") {
      continue;
    }

    const methods = route.methods ?? ["GET"];
    for (const method of methods) {
      apiRoutes.push({
        method,
        path: route.urlPattern,
        filePath: route.filePath,
      });
    }
  }

  return { apiRoutes };
}
