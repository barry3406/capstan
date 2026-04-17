import type { Context as HonoContext } from "hono";
import type { z } from "zod";
import type { ComplianceConfig } from "./compliance.js";
import type { CapstanOpsConfig, CapstanOpsContext } from "./ops.js";

export interface CapstanAuthGrant {
  resource: string;
  action: string;
  scope?: Record<string, string>;
  effect?: "allow" | "deny";
  expiresAt?: string;
}

export interface CapstanActorIdentity {
  kind: "user" | "agent" | "workload" | "system" | "anonymous";
  id: string;
  displayName?: string;
  role?: string;
  email?: string;
  claims?: Record<string, unknown>;
}

export interface CapstanCredentialProof {
  kind:
    | "session"
    | "oauth"
    | "api_key"
    | "mtls"
    | "dpop"
    | "run_token"
    | "approval_token"
    | "anonymous";
  subjectId: string;
  presentedAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CapstanExecutionIdentity {
  kind:
    | "request"
    | "run"
    | "tool_call"
    | "approval"
    | "schedule"
    | "release"
    | "mcp_invocation";
  id: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export interface CapstanDelegationLink {
  from: {
    kind: CapstanActorIdentity["kind"] | CapstanExecutionIdentity["kind"];
    id: string;
  };
  to: {
    kind: CapstanActorIdentity["kind"] | CapstanExecutionIdentity["kind"];
    id: string;
  };
  reason: string;
  issuedAt: string;
  metadata?: Record<string, unknown>;
}

export interface CapstanAuthEnvelope {
  actor: CapstanActorIdentity;
  credential: CapstanCredentialProof;
  execution?: CapstanExecutionIdentity;
  delegation: CapstanDelegationLink[];
  grants: CapstanAuthGrant[];
}

/** Authentication context attached to every request. */
export interface CapstanAuthContext {
  isAuthenticated: boolean;
  type: "human" | "agent" | "anonymous" | "workload";
  userId?: string;
  role?: string;
  email?: string;
  agentId?: string;
  agentName?: string;
  permissions?: string[];
  actor?: CapstanActorIdentity;
  credential?: CapstanCredentialProof;
  execution?: CapstanExecutionIdentity;
  delegation?: CapstanDelegationLink[];
  grants?: CapstanAuthGrant[];
  envelope?: CapstanAuthEnvelope;
  dpopThumbprint?: string;
  spiffeId?: string;
  certFingerprint?: string;
}

/** Per-request context threaded through handlers, middleware, and policies. */
export interface CapstanContext {
  auth: CapstanAuthContext;
  request: Request;
  env: Record<string, string | undefined>;
  honoCtx: HonoContext;
  requestId?: string;
  traceId?: string;
  ops?: CapstanOpsContext;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** The argument bag passed to an API handler. */
export interface APIHandlerInput<T = unknown> {
  input: T;
  ctx: CapstanContext;
  params: Record<string, string>;
}

/** Per-route rate limit configuration. */
export interface RouteRateLimitConfig {
  /** Window duration in milliseconds. */
  window: number;
  /** Maximum requests allowed within the window. */
  max: number;
}

/** Deprecation metadata for a route. */
export interface DeprecationConfig {
  /** ISO-8601 date when the endpoint will be removed. */
  sunset: string;
  /** Human-readable migration message. */
  message?: string;
}

/** Full definition object for a single API route. */
export interface APIDefinition<TInput = unknown, TOutput = unknown> {
  input?: z.ZodType<TInput>;
  output?: z.ZodType<TOutput>;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
  compliance?: ComplianceConfig;

  /** Per-route handler timeout in milliseconds. The handler receives an AbortSignal via ctx. */
  timeout?: number;

  /** Mark this endpoint as deprecated. Adds a Sunset header to responses. */
  deprecated?: DeprecationConfig;

  /** Per-route rate limit that overrides the global rate limit. */
  rateLimit?: RouteRateLimitConfig;

  /** Enable batch endpoint — accepts an array of inputs and returns an array of outputs. */
  batch?: boolean;

  /**
   * Pre-processing hook that runs after input validation but before the handler.
   * May mutate `input` or short-circuit by returning an output value.
   */
  beforeHandler?: (args: {
    input: TInput;
    ctx: CapstanContext;
  }) => Promise<TOutput | void>;

  /**
   * Post-processing hook that runs after the handler returns.
   * May transform the output before it is sent to the client.
   */
  afterHandler?: (args: {
    input: TInput;
    output: TOutput;
    ctx: CapstanContext;
  }) => Promise<TOutput | void>;

  /**
   * Transform the final output value before JSON serialization.
   * Unlike `afterHandler`, this is a pure data transform with no access to ctx.
   */
  transform?: (output: TOutput) => TOutput | Promise<TOutput>;

  /**
   * Error handler that maps thrown errors into structured API error responses.
   * If provided, overrides the default error handling for this route.
   */
  onError?: (
    error: unknown,
    ctx: CapstanContext,
  ) => Promise<{ code: string; message: string; details?: unknown }>;

  handler: (args: APIHandlerInput<TInput>) => Promise<TOutput>;
}

/** Definition object for middleware. */
export interface MiddlewareDefinition {
  name?: string;
  handler: (args: {
    request: Request;
    ctx: CapstanContext;
    next: () => Promise<Response>;
  }) => Promise<Response>;
}

export type PolicyEffect = "allow" | "deny" | "approve" | "redact";

/** Result of evaluating a single policy. */
export interface PolicyCheckResult {
  effect: PolicyEffect;
  reason?: string;
  /** Structured error code for programmatic consumption. */
  code?: string;
}

/** Audit trail entry emitted when a policy decision is recorded. */
export interface PolicyAuditEntry {
  timestamp: string;
  policyKey: string;
  effect: PolicyEffect;
  reason?: string;
  code?: string;
  subject?: string;
  resource?: string;
}

/** Definition object for a named permission policy. */
export interface PolicyDefinition {
  key: string;
  title: string;
  effect: PolicyEffect;
  /** Numeric priority — higher values run first. Default: 0. */
  priority?: number;
  /** Conditional predicate — policy only runs if this returns true. */
  when?: (args: { ctx: CapstanContext; input?: unknown }) => boolean;
  check: (args: {
    ctx: CapstanContext;
    input?: unknown;
  }) => Promise<PolicyCheckResult>;
}

/** Named group of policies that can be applied together. */
export interface PolicyGroup {
  name: string;
  policies: PolicyDefinition[];
}

/** App-level configuration for a Capstan application. */
export interface CapstanConfig {
  app?: {
    name?: string;
    title?: string;
    description?: string;
  };
  database?: {
    provider?: "sqlite" | "postgres" | "mysql" | "libsql";
    url?: string;
  };
  auth?: {
    providers?: Array<{ type: string; [key: string]: unknown }>;
    session?: {
      strategy?: "jwt" | "database";
      secret?: string;
      maxAge?: string;
      cookieName?: string;
      cookie?: {
        path?: string;
        domain?: string;
        secure?: boolean;
        httpOnly?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
      };
    };
    apiKeys?: {
      prefix?: string;
      headerName?: string;
    };
  };
  agent?: {
    manifest?: boolean;
    mcp?: boolean;
    openapi?: boolean;
    rateLimit?: {
      default?: { requests: number; window: string };
      perAgent?: boolean;
    };
  };
  server?: {
    port?: number;
    host?: string;
    /** Graceful shutdown timeout in milliseconds. Default: 30_000. */
    gracefulShutdownMs?: number;
    /** Header name used for request ID propagation. Default: "X-Request-Id". */
    requestIdHeader?: string;
    /** Add X-Response-Time header to every response. Default: false. */
    enableTimingHeader?: boolean;
    /** Maximum request body size in bytes. Default: 1_048_576 (1 MB). */
    maxBodySize?: number;
    /** Enable response compression (gzip). Default: false. */
    compression?: boolean;
    /** Called once the server is fully ready and listening. */
    onReady?: () => void | Promise<void>;
    /** Called when the server begins shutting down. */
    onShutdown?: () => void | Promise<void>;
  };
  plugins?: Array<{ name: string; version?: string; setup: (ctx: unknown) => void | Promise<void> }>;
  ops?: CapstanOpsConfig;
}

/** Route metadata for the agent manifest system. */
export interface RouteMetadata {
  method: HttpMethod;
  path: string;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  deprecated?: DeprecationConfig;
  timeout?: number;
  batch?: boolean;
}
