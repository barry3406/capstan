import { createPageCacheKey, normalizePagePath } from "@zauso-ai/capstan-react";
import type { RenderMode } from "@zauso-ai/capstan-react";

export type RuntimeDiagnosticSeverity = "info" | "warn" | "error";

export interface RuntimeDiagnostic {
  severity: RuntimeDiagnosticSeverity;
  code: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface RouteRuntimeValidationContext {
  urlPattern: string;
  filePath: string;
  routeType: "page" | "api" | "layout" | "middleware" | "loading" | "error" | "not-found";
  routeComponentType?: "server" | "client";
  moduleComponentType?: unknown;
  hasDefaultExport: boolean;
}

export interface PageRuntimeDiagnosticsContext {
  requestUrl: string;
  renderMode: RenderMode;
  effectiveRenderMode: RenderMode;
  transport: "html" | "stream";
  componentType: "server" | "client";
  isNavigationRequest: boolean;
  statusCode: number;
  cacheStatus?: "HIT" | "MISS" | "STALE";
  route?: RouteRuntimeValidationContext;
}

function createDiagnostic(
  severity: RuntimeDiagnosticSeverity,
  code: string,
  message: string,
  data?: Record<string, unknown>,
): RuntimeDiagnostic {
  return data ? { severity, code, message, data } : { severity, code, message };
}

export function createRuntimeDiagnostic(
  severity: RuntimeDiagnosticSeverity,
  code: string,
  message: string,
  data?: Record<string, unknown>,
): RuntimeDiagnostic {
  return createDiagnostic(severity, code, message, data);
}

export function mergeRuntimeDiagnostics(
  ...groups: Array<readonly RuntimeDiagnostic[] | undefined>
): RuntimeDiagnostic[] {
  const merged: RuntimeDiagnostic[] = [];

  for (const group of groups) {
    if (!group) {
      continue;
    }

    merged.push(...group);
  }

  return merged;
}

export function serializeRuntimeDiagnostics(
  diagnostics: readonly RuntimeDiagnostic[],
): string | undefined {
  if (diagnostics.length === 0) {
    return undefined;
  }

  return JSON.stringify(diagnostics);
}

export function runtimeDiagnosticsHeaders(
  diagnostics: readonly RuntimeDiagnostic[],
): Record<string, string> {
  const serialized = serializeRuntimeDiagnostics(diagnostics);
  return serialized ? { "x-capstan-diagnostics": serialized } : {};
}

export function createRouteRuntimeDiagnostics(
  context: RouteRuntimeValidationContext,
): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [];

  if (context.routeComponentType !== undefined) {
    diagnostics.push(
      createDiagnostic(
        "info",
        "route.component-type.scanned",
        `Route scanner marked ${context.urlPattern} as ${context.routeComponentType}.`,
        {
          filePath: context.filePath,
          urlPattern: context.urlPattern,
          routeComponentType: context.routeComponentType,
        },
      ),
    );
  }

  if (context.routeType === "page" && !context.hasDefaultExport) {
    diagnostics.push(
      createDiagnostic(
        "error",
        "route.page.missing-default",
        `Page route ${context.urlPattern} must export a default React component.`,
        {
          filePath: context.filePath,
          urlPattern: context.urlPattern,
        },
      ),
    );
  }

  if (
    context.routeComponentType !== undefined &&
    context.moduleComponentType !== undefined &&
    context.routeComponentType !== context.moduleComponentType
  ) {
    diagnostics.push(
      createDiagnostic(
        "warn",
        "route.component-type.mismatch",
        `Route scanner marked ${context.urlPattern} as ${context.routeComponentType}, but the module export reports ${String(context.moduleComponentType)}.`,
        {
          filePath: context.filePath,
          urlPattern: context.urlPattern,
          routeComponentType: context.routeComponentType,
          moduleComponentType: context.moduleComponentType,
        },
      ),
    );
  }

  return diagnostics;
}

export function createPageRuntimeDiagnostics(
  context: PageRuntimeDiagnosticsContext,
  routeDiagnostics: readonly RuntimeDiagnostic[] = [],
): RuntimeDiagnostic[] {
  const normalizedUrl = normalizePagePath(context.requestUrl);
  const cacheKey = createPageCacheKey(context.requestUrl);
  const diagnostics: RuntimeDiagnostic[] = [...routeDiagnostics];

  diagnostics.push(
    createDiagnostic(
      "info",
      "page-runtime.request",
      "Resolved page runtime request.",
      {
        url: normalizedUrl,
        cacheKey,
        renderMode: context.renderMode,
        effectiveRenderMode: context.effectiveRenderMode,
        transport: context.transport,
        componentType: context.componentType,
        isNavigationRequest: context.isNavigationRequest,
        statusCode: context.statusCode,
      },
    ),
  );

  if (context.renderMode !== context.effectiveRenderMode) {
    diagnostics.push(
      createDiagnostic(
        "info",
        "page-runtime.render-mode-fallback",
        `Runtime downgraded ${context.renderMode} to ${context.effectiveRenderMode}.`,
        {
          url: normalizedUrl,
          cacheKey,
          requestedRenderMode: context.renderMode,
          effectiveRenderMode: context.effectiveRenderMode,
        },
      ),
    );
  }

  if (context.cacheStatus) {
    diagnostics.push(
      createDiagnostic(
        "info",
        "page-runtime.cache",
        `Page render completed with cache status ${context.cacheStatus}.`,
        {
          url: normalizedUrl,
          cacheKey,
          cacheStatus: context.cacheStatus,
        },
      ),
    );
  }

  return diagnostics;
}
