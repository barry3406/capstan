// Public API ----------------------------------------------------------------

export { defineAPI, getAPIRegistry, clearAPIRegistry } from "./api.js";
export { defineMiddleware } from "./middleware.js";
export { csrfProtection } from "./csrf.js";
export { definePolicy, enforcePolicies } from "./policy.js";
export { defineConfig, env } from "./config.js";
export { createCapstanApp } from "./server.js";
export { createContext } from "./context.js";
export {
  createApproval,
  getApproval,
  listApprovals,
  resolveApproval,
  clearApprovals,
} from "./approval.js";
export { mountApprovalRoutes } from "./approval-routes.js";
export type { HandlerRegistry } from "./approval-routes.js";

export type { PendingApproval } from "./approval.js";

export type { CapstanApp } from "./server.js";

export type {
  APIDefinition,
  APIHandlerInput,
  CapstanAuthContext,
  CapstanConfig,
  CapstanContext,
  HttpMethod,
  MiddlewareDefinition,
  PolicyCheckResult,
  PolicyDefinition,
  PolicyEffect,
  RouteMetadata,
} from "./types.js";

export { createRequestLogger } from "./logger.js";

export { defineRateLimit, clearRateLimitStore } from "./ratelimit.js";
export type { RateLimitConfig } from "./ratelimit.js";

export { verifyCapstanApp, renderRuntimeVerifyText } from "./verify.js";
export type { VerifyReport, VerifyDiagnostic, VerifyStep } from "./verify.js";
