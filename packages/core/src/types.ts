import type { Context as HonoContext } from "hono";
import type { z } from "zod";

/** Authentication context attached to every request. */
export interface CapstanAuthContext {
  isAuthenticated: boolean;
  type: "human" | "agent" | "anonymous";
  userId?: string;
  role?: string;
  email?: string;
  agentId?: string;
  agentName?: string;
  permissions?: string[];
}

/** Per-request context threaded through handlers, middleware, and policies. */
export interface CapstanContext {
  auth: CapstanAuthContext;
  request: Request;
  env: Record<string, string | undefined>;
  honoCtx: HonoContext;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** The argument bag passed to an API handler. */
export interface APIHandlerInput<T = unknown> {
  input: T;
  ctx: CapstanContext;
}

/** Full definition object for a single API route. */
export interface APIDefinition<TInput = unknown, TOutput = unknown> {
  input?: z.ZodType<TInput>;
  output?: z.ZodType<TOutput>;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
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
    provider?: "sqlite" | "postgres" | "mysql";
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
