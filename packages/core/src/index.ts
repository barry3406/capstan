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

export { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";
export type { CircuitBreakerConfig, CircuitState } from "./circuit-breaker.js";

export type { VerifyReport, VerifyDiagnostic, VerifyStep } from "./verify.js";
export { renderRuntimeVerifyText } from "./verify-render.js";
export async function verifyCapstanApp(
  ...args: Parameters<typeof import("./verify.js").verifyCapstanApp>
): Promise<import("./verify.js").VerifyReport> {
  const mod = await import("./verify.js");
  return mod.verifyCapstanApp(...args);
}

export { defineWebSocket, WebSocketRoom } from "./websocket.js";
export type {
  WebSocketHandler,
  WebSocketClient,
  WebSocketRoute,
} from "./websocket.js";

export {
  cacheSet,
  cacheGet,
  cacheInvalidateTag,
  cacheInvalidate,
  cacheClear,
  cached,
  setCacheStore,
} from "./cache.js";
export type { CacheOptions, CacheEntry } from "./cache.js";

export {
  responseCacheGet,
  responseCacheSet,
  responseCacheInvalidateTag,
  responseCacheInvalidate,
  responseCacheClear,
  setResponseCacheStore,
} from "./response-cache.js";
export type { ResponseCacheEntry } from "./response-cache.js";
