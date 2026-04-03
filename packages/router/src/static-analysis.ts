import { readFileSync, statSync } from "node:fs";

import type {
  RouteDiagnostic,
  RouteStaticInfo,
  RouteType,
} from "./types.js";

interface StaticAnalysisCacheEntry {
  signature: string;
  result: {
    staticInfo?: RouteStaticInfo;
    diagnostics: RouteDiagnostic[];
  };
}

const staticAnalysisCache = new Map<string, StaticAnalysisCacheEntry>();

const PAGE_ONLY_EXPORTS = [
  "loader",
  "hydration",
  "renderMode",
  "revalidate",
  "cacheTags",
  "generateStaticParams",
];

const BOUNDARY_FORBIDDEN_EXPORTS: Partial<Record<RouteType, string[]>> = {
  loading: PAGE_ONLY_EXPORTS,
  error: PAGE_ONLY_EXPORTS,
  layout: PAGE_ONLY_EXPORTS,
  "not-found": PAGE_ONLY_EXPORTS,
};

function readSignature(filePath: string): string | null {
  try {
    const stats = statSync(filePath);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return null;
  }
}

function extractExportNames(source: string): string[] {
  const names = new Set<string>();

  if (/export\s+default(?:\s+async)?(?:\s+function|\s+class|\s+\(|\s+\{|\s+[^;\n]+)/.test(source)) {
    names.add("default");
  }

  for (const match of source.matchAll(/export\s+(?:const|let|var|async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]!);
  }

  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    const raw = match[1]!;
    for (const part of raw.split(",")) {
      const cleaned = part.trim();
      if (cleaned === "") {
        continue;
      }
      const aliasMatch = cleaned.match(/(?:^|\s)as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) {
        names.add(aliasMatch[1]!);
        continue;
      }
      const tokenMatch = cleaned.match(/^([A-Za-z_$][\w$]*)/);
      if (tokenMatch) {
        names.add(tokenMatch[1]!);
      }
    }
  }

  return [...names].sort();
}

function extractRenderMode(source: string): RouteStaticInfo["renderMode"] | undefined | "invalid" {
  const match = source.match(/export\s+const\s+renderMode\s*=\s*["']([^"']+)["']/);
  if (!match) {
    return undefined;
  }

  switch (match[1]) {
    case "ssr":
    case "ssg":
    case "isr":
    case "streaming":
      return match[1];
    default:
      return "invalid";
  }
}

function extractRevalidate(source: string): number | undefined {
  const match = source.match(/export\s+const\s+revalidate\s*=\s*(-?(?:\d+|\d+\.\d+))/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createDiagnostic(
  routeType: RouteType,
  urlPattern: string,
  filePath: string,
  message: string,
): RouteDiagnostic {
  return {
    code: "invalid-route-export",
    severity: "warning",
    message,
    routeType,
    urlPattern,
    canonicalPattern: urlPattern,
    filePaths: [filePath],
  };
}

export function analyzeRouteFileStaticInfo(
  filePath: string,
  routeType: RouteType,
  urlPattern: string,
  hasDynamicParams: boolean,
): {
  staticInfo?: RouteStaticInfo;
  diagnostics: RouteDiagnostic[];
} {
  const signature = readSignature(filePath);
  const cached = signature ? staticAnalysisCache.get(filePath) : undefined;
  if (signature && cached?.signature === signature) {
    return cached.result;
  }

  let source = "";
  try {
    source = readFileSync(filePath, "utf-8");
  } catch {
    const fallback = { diagnostics: [] as RouteDiagnostic[] };
    if (signature) {
      staticAnalysisCache.set(filePath, { signature, result: fallback });
    }
    return fallback;
  }

  const exportNames = extractExportNames(source);
  const renderMode = extractRenderMode(source);
  const revalidate = extractRevalidate(source);
  const hasMetadata = exportNames.includes("metadata");
  const hasGenerateStaticParams = exportNames.includes("generateStaticParams");
  const diagnostics: RouteDiagnostic[] = [];

  if (renderMode === "invalid") {
    diagnostics.push(
      createDiagnostic(
        routeType,
        urlPattern,
        filePath,
        "renderMode must be one of ssr, ssg, isr, or streaming.",
      ),
    );
  }

  const forbiddenExports = BOUNDARY_FORBIDDEN_EXPORTS[routeType] ?? [];
  const boundaryViolations = exportNames.filter((name) => forbiddenExports.includes(name));
  if (boundaryViolations.length > 0) {
    diagnostics.push(
      createDiagnostic(
        routeType,
        urlPattern,
        filePath,
        `${routeType} routes should not export ${boundaryViolations.join(", ")} because those exports are ignored.`,
      ),
    );
  }

  if (routeType === "page") {
    if (renderMode === "ssg" && hasDynamicParams && !hasGenerateStaticParams) {
      diagnostics.push(
        createDiagnostic(
          routeType,
          urlPattern,
          filePath,
          "Dynamic SSG pages should export generateStaticParams() so build output stays deterministic.",
        ),
      );
    }

    if (!hasDynamicParams && hasGenerateStaticParams) {
      diagnostics.push(
        createDiagnostic(
          routeType,
          urlPattern,
          filePath,
          "generateStaticParams() is exported on a page without dynamic params and will be ignored.",
        ),
      );
    }
  }

  const staticInfo = exportNames.length > 0 || renderMode || revalidate !== undefined || hasMetadata || hasGenerateStaticParams
    ? {
        exportNames,
        ...(hasMetadata ? { hasMetadata: true } : {}),
        ...(renderMode && renderMode !== "invalid" ? { renderMode } : {}),
        ...(revalidate !== undefined ? { revalidate } : {}),
        ...(hasGenerateStaticParams ? { hasGenerateStaticParams: true } : {}),
      } satisfies RouteStaticInfo
    : undefined;

  const result = {
    ...(staticInfo ? { staticInfo } : {}),
    diagnostics,
  };

  if (signature) {
    staticAnalysisCache.set(filePath, {
      signature,
      result,
    });
  }

  return result;
}

export function clearRouteStaticAnalysisCache(filePath?: string): void {
  if (filePath) {
    staticAnalysisCache.delete(filePath);
    return;
  }

  staticAnalysisCache.clear();
}
