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

export {
  defineCompliance,
  recordAuditEntry,
  getAuditLog,
  clearAuditLog,
  setAuditStore,
} from "./compliance.js";
export type {
  ComplianceConfig,
  RiskLevel,
  AuditEntry,
} from "./compliance.js";

export { MemoryStore } from "./store.js";
export type { KeyValueStore } from "./store.js";
export { RedisStore } from "./redis-store.js";

export { defineRateLimit, clearRateLimitStore } from "./ratelimit.js";
export type { RateLimitConfig } from "./ratelimit.js";

export {
  Counter,
  Histogram,
  counter,
  histogram,
  serializeMetrics,
  resetMetrics,
} from "./metrics.js";

export { definePlugin } from "./plugin.js";
export type { CapstanPlugin, CapstanPluginContext } from "./plugin.js";

export { setApprovalStore } from "./approval.js";
export { setRateLimitStore } from "./ratelimit.js";

export {
  defineEvent,
  onEvent,
  emitEvent,
  getEventBus,
  resetEventBus,
} from "./events.js";
export type { EventDefinition } from "./events.js";

export { defineWorker } from "./worker.js";
export type { WorkerDefinition } from "./worker.js";

export { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitState } from "./circuit-breaker.js";

export { verifyCapstanApp, renderRuntimeVerifyText } from "./verify.js";
export type { VerifyReport, VerifyDiagnostic, VerifyStep } from "./verify.js";
