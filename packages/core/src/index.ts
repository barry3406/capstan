// Public API ----------------------------------------------------------------

export { defineAPI, getAPIRegistry } from "./api.js";
export { defineMiddleware } from "./middleware.js";
export { definePolicy, enforcePolicies } from "./policy.js";
export { defineConfig, env } from "./config.js";
export { createCapstanApp } from "./server.js";
export { createContext } from "./context.js";

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
