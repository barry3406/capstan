export type RouteType = "page" | "api" | "layout" | "middleware";

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
}

export interface RouteManifest {
  routes: RouteEntry[];
  /** Timestamp of last scan */
  scannedAt: string;
  /** Root directory that was scanned */
  rootDir: string;
}

export interface MatchedRoute {
  route: RouteEntry;
  params: Record<string, string>;
}
