// Public API ----------------------------------------------------------------

export {
  defineAPI,
  getAPIRegistry,
  clearAPIRegistry,
  checkRouteRateLimit,
  clearRouteRateLimits,
  coerceQueryInput,
  withTimeout,
  TimeoutError,
  buildSunsetHeader,
} from "./api.js";
export type { StructuredAPIError } from "./api.js";
export {
  defineAction,
  actionOk,
  actionError,
  actionRedirect,
  isActionDefinition,
  ActionRedirectError,
} from "./action.js";
export type {
  ActionResult,
  ActionArgs,
  ActionDefinition,
} from "./action.js";
export { defineMiddleware } from "./middleware.js";
export { csrfProtection } from "./csrf.js";
export {
  definePolicy,
  enforcePolicies,
  composePolicy,
  definePolicyGroup,
  applyPolicyGroup,
  getPolicyAuditLog,
  clearPolicyAuditLog,
  denyWithCode,
  allowResult,
} from "./policy.js";
export { defineConfig, env } from "./config.js";
export { createCapstanApp } from "./server.js";
export { createContext } from "./context.js";
export {
  createCapstanOpsContext,
  createCapstanOpsRuntime,
  createRequestIdentity,
} from "./ops.js";
export type {
  CapstanOpsConfig,
  CapstanOpsContext,
  CapstanOpsEvent,
  CapstanHealthSnapshot,
  CapstanOpsIncident,
  CapstanOpsQuery,
  CapstanOpsRuntime,
  CapstanOpsSink,
  CapstanOpsStore,
} from "./ops.js";
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
    CapstanActorIdentity,
    CapstanAuthContext,
    CapstanAuthEnvelope,
    CapstanAuthGrant,
    CapstanConfig,
    CapstanContext,
    CapstanCredentialProof,
    CapstanDelegationLink,
    CapstanExecutionIdentity,
    DeprecationConfig,
    HttpMethod,
    MiddlewareDefinition,
    PolicyAuditEntry,
    PolicyCheckResult,
    PolicyDefinition,
    PolicyEffect,
    PolicyGroup,
    RouteMetadata,
    RouteRateLimitConfig,
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

export type { VerifyReport, VerifyDiagnostic, VerifyStep } from "./verify-types.js";
export { renderRuntimeVerifyText } from "./verify-render.js";
export async function verifyCapstanApp(
  ...args: Parameters<typeof import("./verify.js").verifyCapstanApp>
): Promise<import("./verify-types.js").VerifyReport> {
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
  cacheInvalidatePath,
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
  responseCacheInvalidatePath,
  responseCacheInvalidate,
  responseCacheClear,
  setResponseCacheStore,
} from "./response-cache.js";
export type { ResponseCacheEntry } from "./response-cache.js";

export {
  normalizeCacheTag,
  normalizeCacheTags,
  normalizeCachePath,
  createPageCacheKey,
} from "./cache-utils.js";

export {
  createImageOptimizer,
  negotiateFormat,
  computeImageCacheKey,
  normalizeTransformOptions,
  parseImageQuery,
  ImageOptimizerError,
} from "./image-optimizer.js";
export type {
  ImageTransformOptions,
  ImageTransformResult,
  ImageOptimizerConfig,
  ImageOptimizer,
  ImageOptimizerErrorCode,
} from "./image-optimizer.js";
