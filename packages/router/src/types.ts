export type RouteType = "page" | "api" | "layout" | "middleware" | "loading" | "error" | "not-found";

export type RouteConflictReason =
  | "duplicate-route"
  | "ambiguous-route"
  | "ambiguous-not-found"
  | "invalid-route-pattern"
  | "invalid-route-export";

export type RouteDiagnosticSeverity = "error" | "warning";

export interface RouteDiagnostic {
  code: RouteConflictReason;
  severity: RouteDiagnosticSeverity;
  message: string;
  routeType: RouteType;
  urlPattern: string;
  canonicalPattern: string;
  filePaths: string[];
  directoryDepth?: number;
}

export interface RouteConflict {
  routeType: RouteType;
  urlPattern: string;
  canonicalPattern?: string;
  filePaths: string[];
  reason: RouteConflictReason;
  /** Directory depth is used to distinguish scoped not-found boundaries. */
  directoryDepth?: number;
}

export interface RouteConflictError extends Error {
  code: "ROUTE_CONFLICT";
  conflicts: RouteConflict[];
  diagnostics: RouteDiagnostic[];
}

export interface RouteStaticInfo {
  exportNames: string[];
  hasMetadata?: boolean;
  renderMode?: "ssr" | "ssg" | "isr" | "streaming";
  revalidate?: number;
  hasGenerateStaticParams?: boolean;
}

export interface RouteEntry {
  /** Absolute file path */
  filePath: string;
  /** Route type determined by file suffix */
  type: RouteType;
  /** URL path pattern, e.g. "/tickets/:id" */
  urlPattern: string;
  /** HTTP methods this route handles (for api routes) */
  methods?: string[];
  /** Parent layout file paths (from outermost to innermost) */
  layouts: string[];
  /** Middleware file paths (from outermost to innermost) */
  middlewares: string[];
  /** Dynamic parameter names */
  params: string[];
  /** Whether this is a catch-all route */
  isCatchAll: boolean;
  /** Hydration strategy for page routes */
  hydration?: "full" | "visible" | "none";
  /** Whether the page component uses client-side interactivity */
  componentType?: "server" | "client";
  /** Nearest _loading.tsx file path (for Suspense boundary) */
  loading?: string;
  /** Nearest _error.tsx file path (for ErrorBoundary) */
  error?: string;
  /** Nearest not-found boundary file path for this route's scope */
  notFound?: string;
  /** Lightweight static analysis from the route source file. */
  staticInfo?: RouteStaticInfo;
}

export interface RouteManifest {
  routes: RouteEntry[];
  diagnostics?: RouteDiagnostic[];
  /** Timestamp of last scan */
  scannedAt: string;
  /** Root directory that was scanned */
  rootDir: string;
}

export interface MatchedRoute {
  route: RouteEntry;
  params: Record<string, string>;
}
