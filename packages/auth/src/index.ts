export { signSession, verifySession } from "./session.js";
export {
  generateApiKey,
  verifyApiKey,
  extractApiKeyPrefix,
} from "./api-key.js";
export { createAuthMiddleware } from "./middleware.js";
export { checkPermission, derivePermission } from "./permissions.js";
export { validateDpopProof, clearDpopReplayCache, setDpopReplayStore } from "./dpop.js";
export { extractWorkloadIdentity, isValidSpiffeId } from "./workload.js";
export {
  googleProvider,
  githubProvider,
  createOAuthHandlers,
} from "./oauth.js";
export type { DpopValidationResult } from "./dpop.js";
export type { WorkloadIdentity } from "./workload.js";
export type { OAuthProvider, OAuthConfig, OAuthHandlers } from "./oauth.js";
export type {
  AuthConfig,
  SessionPayload,
  AgentCredential,
  AuthContext,
  AuthResolverDeps,
} from "./types.js";
