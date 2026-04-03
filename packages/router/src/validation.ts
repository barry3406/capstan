import path from "node:path";

import type {
  RouteConflict,
  RouteConflictError,
  RouteDiagnostic,
  RouteEntry,
  RouteType,
} from "./types.js";

interface PatternShape {
  segments: string[];
  prefixSegments: string[];
  prefixStaticCount: number;
  prefixSegmentCount: number;
  hasCatchAll: boolean;
  canonicalPattern: string;
}

interface DirectRouteScore {
  prefixSegmentCount: number;
  prefixStaticCount: number;
  hasCatchAll: boolean;
}

interface RouteAnalysis {
  route: RouteEntry;
  pattern: PatternShape;
  directScore?: DirectRouteScore;
  directoryDepth: number;
  invalid: boolean;
}

type DiagnosableRouteType = RouteDiagnostic["routeType"];
type DiagnosableRouteEntry = RouteEntry & { type: DiagnosableRouteType };
type DiagnosableRouteAnalysis = RouteAnalysis & { route: DiagnosableRouteEntry };

const ROUTE_CATEGORY_ORDER: Record<RouteType, number> = {
  page: 0,
  api: 1,
  "not-found": 2,
  layout: 3,
  loading: 4,
  error: 5,
  middleware: 6,
};

function splitPattern(urlPattern: string): string[] {
  return urlPattern.split("/").filter(Boolean);
}

function canonicalizePattern(segments: string[]): string {
  if (segments.length === 0) {
    return "/";
  }

  return `/${segments
    .map((segment) => {
      if (segment === "*") return "*";
      if (segment.startsWith(":")) return ":";
      return segment;
    })
    .join("/")}`;
}

function describePattern(urlPattern: string): PatternShape {
  const segments = splitPattern(urlPattern);
  const hasCatchAll = segments.includes("*");
  const prefixSegments = hasCatchAll ? segments.slice(0, -1) : segments.slice();
  let prefixStaticCount = 0;
  for (const segment of prefixSegments) {
    if (segment !== "*" && !segment.startsWith(":")) {
      prefixStaticCount++;
    }
  }

  return {
    segments,
    prefixSegments,
    prefixStaticCount,
    prefixSegmentCount: prefixSegments.length,
    hasCatchAll,
    canonicalPattern: canonicalizePattern(segments),
  };
}

function routeCategory(route: RouteEntry): number {
  return ROUTE_CATEGORY_ORDER[route.type];
}

function isDirectRoute(route: RouteEntry): boolean {
  return route.type === "page" || route.type === "api";
}

function isDiagnosableRoute(route: RouteEntry): route is DiagnosableRouteEntry {
  return route.type === "page" || route.type === "api" || route.type === "not-found";
}

function countDirectoryDepth(filePath: string, rootDir: string): number {
  const normalizedRoot = path.resolve(rootDir).replace(/\\+/g, "/").replace(/\/+$/, "");
  const normalizedFile = path.resolve(filePath).replace(/\\+/g, "/");

  if (normalizedFile !== normalizedRoot && !normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return 0;
  }

  const relativePath = normalizedFile.slice(normalizedRoot.length).replace(/^\/+/, "");
  const segments = relativePath.split("/").filter(Boolean);
  return segments.length > 1 ? segments.length - 1 : 0;
}

function isInvalidPattern(route: RouteEntry, pattern: PatternShape): boolean {
  const catchAllCount = pattern.segments.filter((segment) => segment === "*").length;
  if (catchAllCount > 1) {
    return true;
  }

  if (catchAllCount === 1 && pattern.segments.at(-1) !== "*") {
    return true;
  }

  return route.params.length !== new Set(route.params).size;
}

function analyzeRoute(route: RouteEntry, rootDir: string): RouteAnalysis {
  const pattern = describePattern(route.urlPattern);
  const directScore = isDirectRoute(route)
    ? {
        prefixSegmentCount: pattern.prefixSegmentCount,
        prefixStaticCount: pattern.prefixStaticCount,
        hasCatchAll: pattern.hasCatchAll,
      }
    : undefined;

  return {
    route,
    pattern,
    directoryDepth: countDirectoryDepth(route.filePath, rootDir),
    invalid: isInvalidPattern(route, pattern),
    ...(directScore ? { directScore } : {}),
  };
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function compareDirectRoutes(a: RouteAnalysis, b: RouteAnalysis): number {
  const aScore = a.directScore!;
  const bScore = b.directScore!;

  if (aScore.prefixSegmentCount !== bScore.prefixSegmentCount) {
    return bScore.prefixSegmentCount - aScore.prefixSegmentCount;
  }

  if (aScore.prefixStaticCount !== bScore.prefixStaticCount) {
    return bScore.prefixStaticCount - aScore.prefixStaticCount;
  }

  if (aScore.hasCatchAll !== bScore.hasCatchAll) {
    return Number(aScore.hasCatchAll) - Number(bScore.hasCatchAll);
  }

  const categoryCmp = routeCategory(a.route) - routeCategory(b.route);
  if (categoryCmp !== 0) {
    return categoryCmp;
  }

  return compareStrings(a.route.filePath, b.route.filePath);
}

function compareNotFoundRoutes(a: RouteAnalysis, b: RouteAnalysis): number {
  if (a.pattern.segments.length !== b.pattern.segments.length) {
    return b.pattern.segments.length - a.pattern.segments.length;
  }

  if (a.directoryDepth !== b.directoryDepth) {
    return b.directoryDepth - a.directoryDepth;
  }

  return compareStrings(a.route.filePath, b.route.filePath);
}

function compareBoundaryRoutes(a: RouteEntry, b: RouteEntry): number {
  const categoryCmp = routeCategory(a) - routeCategory(b);
  if (categoryCmp !== 0) {
    return categoryCmp;
  }

  const patternCmp = a.urlPattern.localeCompare(b.urlPattern);
  if (patternCmp !== 0) {
    return patternCmp;
  }

  return compareStrings(a.filePath, b.filePath);
}

function routesOverlap(aPattern: PatternShape, bPattern: PatternShape): boolean {
  const compareLength = Math.min(aPattern.prefixSegments.length, bPattern.prefixSegments.length);

  for (let index = 0; index < compareLength; index++) {
    const leftSegment = aPattern.prefixSegments[index]!;
    const rightSegment = bPattern.prefixSegments[index]!;
    if (
      leftSegment !== "*" &&
      rightSegment !== "*" &&
      !leftSegment.startsWith(":") &&
      !rightSegment.startsWith(":") &&
      leftSegment !== rightSegment
    ) {
      return false;
    }
  }

  if (!aPattern.hasCatchAll && !bPattern.hasCatchAll) {
    return aPattern.segments.length === bPattern.segments.length;
  }

  if (aPattern.hasCatchAll && bPattern.hasCatchAll) {
    return true;
  }

  const catchAllPattern = aPattern.hasCatchAll ? aPattern : bPattern;
  const otherPattern = aPattern.hasCatchAll ? bPattern : aPattern;
  return otherPattern.segments.length >= catchAllPattern.prefixSegments.length;
}

function buildInvalidPatternDiagnostic(analysis: DiagnosableRouteAnalysis): RouteDiagnostic {
  return {
    code: "invalid-route-pattern",
    severity: "error",
    message: `Invalid route pattern ${analysis.route.urlPattern}`,
    routeType: analysis.route.type,
    urlPattern: analysis.route.urlPattern,
    canonicalPattern: analysis.pattern.canonicalPattern,
    filePaths: [analysis.route.filePath],
  };
}

function buildRouteConflictDiagnostic(
  code: "duplicate-route" | "ambiguous-route",
  left: DiagnosableRouteAnalysis,
  right: DiagnosableRouteAnalysis,
): RouteDiagnostic {
  return {
    code,
    severity: "error",
    message:
      code === "duplicate-route"
        ? `Duplicate ${left.route.type} route for ${left.route.urlPattern}`
        : `Ambiguous ${left.route.type} routes overlap at ${left.pattern.canonicalPattern}`,
    routeType: left.route.type,
    urlPattern: left.route.urlPattern,
    canonicalPattern: left.pattern.canonicalPattern,
    filePaths: [left.route.filePath, right.route.filePath].sort(compareStrings),
  };
}

function buildNotFoundConflictDiagnostic(
  analyses: RouteAnalysis[],
): RouteDiagnostic[] {
  const diagnostics: RouteDiagnostic[] = [];
  const grouped = new Map<string, RouteAnalysis[]>();

  for (const analysis of analyses) {
    const key = `${analysis.route.urlPattern}|${analysis.directoryDepth}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(analysis);
    grouped.set(key, bucket);
  }

  for (const bucket of grouped.values()) {
    if (bucket.length < 2) {
      continue;
    }

    const sorted = [...bucket].sort((left, right) =>
      compareStrings(left.route.filePath, right.route.filePath)
    );
    diagnostics.push({
      code: "ambiguous-not-found",
      severity: "error",
      message: `Ambiguous not-found routes overlap at ${sorted[0]!.route.urlPattern}`,
      routeType: "not-found",
      urlPattern: sorted[0]!.route.urlPattern,
      canonicalPattern: sorted[0]!.pattern.canonicalPattern,
      filePaths: sorted.map((analysis) => analysis.route.filePath),
      directoryDepth: sorted[0]!.directoryDepth,
    });
  }

  return diagnostics;
}

function compareDiagnostics(a: RouteDiagnostic, b: RouteDiagnostic): number {
  const routeTypeCmp = routeCategory({ type: a.routeType } as RouteEntry) -
    routeCategory({ type: b.routeType } as RouteEntry);
  if (routeTypeCmp !== 0) {
    return routeTypeCmp;
  }

  const patternCmp = a.urlPattern.localeCompare(b.urlPattern);
  if (patternCmp !== 0) {
    return patternCmp;
  }

  const codeCmp = a.code.localeCompare(b.code);
  if (codeCmp !== 0) {
    return codeCmp;
  }

  const pathCmp = a.filePaths.join("\u0000").localeCompare(b.filePaths.join("\u0000"));
  if (pathCmp !== 0) {
    return pathCmp;
  }

  return compareStrings(a.message, b.message);
}

function createDirectRouteBucketKey(analysis: RouteAnalysis): string {
  const score = analysis.directScore!;
  return [
    analysis.route.type,
    score.prefixSegmentCount,
    score.prefixStaticCount,
    score.hasCatchAll ? "1" : "0",
  ].join("|");
}

export interface CanonicalizedRouteManifest {
  routes: RouteEntry[];
  diagnostics: RouteDiagnostic[];
}

export function canonicalizeRouteManifest(
  routes: RouteEntry[],
  rootDir: string,
): CanonicalizedRouteManifest {
  const diagnostics: RouteDiagnostic[] = [];
  const analyses = routes.map((route) => analyzeRoute(route, rootDir));
  const analysisByRoute = new Map<RouteEntry, RouteAnalysis>(
    analyses.map((analysis) => [analysis.route, analysis]),
  );

  const invalidRoutes = new Set<RouteEntry>();
  for (const analysis of analyses) {
    if (!analysis.invalid) {
      continue;
    }

    invalidRoutes.add(analysis.route);
    if (isDiagnosableRoute(analysis.route)) {
      diagnostics.push(buildInvalidPatternDiagnostic(analysis as DiagnosableRouteAnalysis));
    }
  }

  const directRouteBuckets = new Map<string, RouteAnalysis[]>();
  const validNotFoundRoutes: RouteAnalysis[] = [];

  for (const analysis of analyses) {
    if (invalidRoutes.has(analysis.route)) {
      continue;
    }

    if (analysis.route.type === "not-found") {
      validNotFoundRoutes.push(analysis);
      continue;
    }

    if (analysis.directScore) {
      const bucketKey = createDirectRouteBucketKey(analysis);
      const bucket = directRouteBuckets.get(bucketKey) ?? [];
      bucket.push(analysis);
      directRouteBuckets.set(bucketKey, bucket);
    }
  }

  for (const bucket of directRouteBuckets.values()) {
    if (bucket.length < 2) {
      continue;
    }

    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex++) {
        const left = bucket[leftIndex]!;
        const right = bucket[rightIndex]!;

        if (!routesOverlap(left.pattern, right.pattern)) {
          continue;
        }

        diagnostics.push(
          buildRouteConflictDiagnostic(
            left.route.urlPattern === right.route.urlPattern ? "duplicate-route" : "ambiguous-route",
            left as DiagnosableRouteAnalysis,
            right as DiagnosableRouteAnalysis,
          ),
        );
      }
    }
  }

  diagnostics.push(...buildNotFoundConflictDiagnostic(validNotFoundRoutes));

  const sortedRoutes = [...routes].sort((left, right) => {
    const leftDirect = isDirectRoute(left);
    const rightDirect = isDirectRoute(right);

    if (leftDirect && rightDirect) {
      return compareDirectRoutes(analysisByRoute.get(left)!, analysisByRoute.get(right)!);
    }

    if (left.type === "not-found" && right.type === "not-found") {
      return compareNotFoundRoutes(analysisByRoute.get(left)!, analysisByRoute.get(right)!);
    }

    if (leftDirect !== rightDirect) {
      return leftDirect ? -1 : 1;
    }

    if (left.type === "not-found" || right.type === "not-found") {
      if (left.type === "not-found" && right.type !== "not-found") {
        return -1;
      }
      if (right.type === "not-found" && left.type !== "not-found") {
        return 1;
      }
    }

    return compareBoundaryRoutes(left, right);
  });

  diagnostics.sort(compareDiagnostics);

  return {
    routes: sortedRoutes,
    diagnostics,
  };
}

export function validateRouteManifest(
  routes: RouteEntry[],
  rootDir: string,
): CanonicalizedRouteManifest {
  return canonicalizeRouteManifest(routes, rootDir);
}

export function createRouteConflictError(
  diagnostics: RouteDiagnostic[],
): RouteConflictError {
  const conflicts: RouteConflict[] = diagnostics.map((diagnostic) => ({
    routeType: diagnostic.routeType,
    urlPattern: diagnostic.urlPattern,
    canonicalPattern: diagnostic.canonicalPattern,
    filePaths: [...diagnostic.filePaths],
    reason: diagnostic.code,
    ...(diagnostic.directoryDepth !== undefined
      ? { directoryDepth: diagnostic.directoryDepth }
      : {}),
  }));

  const error = new Error(
    conflicts.length === 1
      ? `Route conflict detected for ${conflicts[0]!.routeType} route ${conflicts[0]!.urlPattern}`
      : `Route conflict detected across ${conflicts.length} route groups`,
  ) as RouteConflictError;
  error.code = "ROUTE_CONFLICT";
  error.conflicts = conflicts;
  error.diagnostics = diagnostics;
  return error;
}
