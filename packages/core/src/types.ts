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

/** Full definition object for a single API route. */
export interface APIDefinition<TInput = unknown, TOutput = unknown> {
  input?: z.ZodType<TInput>;
  output?: z.ZodType<TOutput>;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
  compliance?: ComplianceConfig;
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
}

/** Definition object for a named permission policy. */
export interface PolicyDefinition {
  key: string;
  title: string;
  effect: PolicyEffect;
  check: (args: {
    ctx: CapstanContext;
    input?: unknown;
  }) => Promise<PolicyCheckResult>;
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
}
