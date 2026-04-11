import type { AgentCredential } from "@zauso-ai/capstan-auth";
import type { RuntimeDiagnostic } from "./runtime-diagnostics.js";

export interface DevServerConfig {
  /** Root directory of the Capstan app (contains app/ directory) */
  rootDir: string;
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** App name for manifests */
  appName?: string;
  /** App description */
  appDescription?: string;
  /** Directory for static assets (defaults to <rootDir>/app/public) */
  publicDir?: string;
  /** Maximum request body size in bytes (default: 1048576 = 1 MB) */
  maxBodySize?: number;
  /** Auth configuration — when set, session cookie / API key auth is enabled */
  auth?: {
    session: {
      secret: string;
      maxAge?: string;
    };
    apiKeys?: {
      prefix?: string;
      headerName?: string;
    };
  };
  /** Optional semantic ops integration. Defaults to a project sink backed by .capstan/ops/ops.db when enabled. */
  ops?: import("@zauso-ai/capstan-core").CapstanOpsConfig;
  /** Optional image optimizer configuration for the /_capstan/image endpoint. */
  imageOptimizer?: import("@zauso-ai/capstan-core").ImageOptimizerConfig;
}

export interface RuntimeRouteRegistryEntry {
  method: string;
  path: string;
  description?: string;
  capability?: "read" | "write" | "external";
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface RuntimeAssetRecord {
  body: string;
  encoding?: "utf-8" | "base64";
  contentType?: string;
}

export interface RuntimeAssetProvider {
  readStaticHtml?: (urlPath: string) => Promise<string | null>;
  readPublicAsset?: (urlPath: string) => Promise<RuntimeAssetRecord | null>;
  readClientAsset?: (assetPath: string) => Promise<RuntimeAssetRecord | null>;
}

export interface RuntimeAppConfig extends DevServerConfig {
  /** Pre-scanned route manifest to register. */
  manifest: import("@zauso-ai/capstan-router").RouteManifest;
  /** Runtime mode controls dev-only behavior such as live reload. */
  mode?: "development" | "production";
  /** Serve pre-rendered SSG output from this directory when present. */
  staticDir?: string;
  /** Inject live reload into HTML responses when true. */
  liveReload?: boolean;
  /** Override the default permissive CORS middleware; false disables it entirely. */
  corsOptions?: Parameters<typeof import("hono/cors").cors>[0] | false;
  /** Optional custom policy registry used by runtime policy enforcement. */
  policyRegistry?: ReadonlyMap<
    string,
    import("@zauso-ai/capstan-core").PolicyDefinition
  >;
  /** How unknown custom policies should be handled at runtime. */
  unknownPolicyMode?: "approve" | "deny";
  /** Optional lookup used by auth middleware when resolving agent API keys. */
  findAgentByKeyPrefix?: (prefix: string) => Promise<AgentCredential | null>;
  /** Optional client runtime directory override for self-contained bundles. */
  clientDir?: string;
  /** Optional asset provider for runtimes without filesystem access. */
  assetProvider?: RuntimeAssetProvider;
}

export interface RuntimeAppBuild {
  app: import("hono").Hono<{ Variables: {
    capstanAuth: import("@zauso-ai/capstan-core").CapstanAuthContext;
    capstanOps?: import("@zauso-ai/capstan-core").CapstanOpsContext;
    capstanRequestId?: string;
    capstanTraceId?: string;
  } }>;
  apiRouteCount: number;
  pageRouteCount: number;
  routeRegistry: RuntimeRouteRegistryEntry[];
  diagnostics?: RuntimeDiagnostic[];
}

export interface DevServerInstance {
  /** Start the dev server */
  start(): Promise<void>;
  /** Stop the dev server */
  stop(): Promise<void>;
  /** Current port */
  port: number;
  /** Current host */
  host: string;
}
