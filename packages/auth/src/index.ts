export { signSession, verifySession } from "./session.js";
export {
  generateApiKey,
  verifyApiKey,
  extractApiKeyPrefix,
} from "./api-key.js";
export { createAuthMiddleware } from "./middleware.js";
export {
  authorizeGrant,
  checkGrant,
  checkPermission,
  derivePermission,
  normalizePermissionsToGrants,
  serializeGrantsToPermissions,
} from "./permissions.js";
export {
  createExecutionIdentity,
  createRequestExecution,
  createDelegationLink,
} from "./execution.js";
export {
  createGrant,
  grantRunActions,
  grantRunCollectionActions,
  grantApprovalActions,
  grantApprovalCollectionActions,
  grantEventActions,
  grantEventCollectionActions,
  grantArtifactActions,
  grantCheckpointActions,
  grantTaskActions,
  grantSummaryActions,
  grantSummaryCollectionActions,
  grantMemoryActions,
  grantContextActions,
  grantRuntimePathsActions,
} from "./runtime-grants.js";
export {
  deriveRuntimeGrantRequirements,
  authorizeRuntimeAction,
  createRuntimeGrantAuthorizer,
} from "./runtime-authorizer.js";
export {
  createHarnessGrantAuthorizer,
  toRuntimeGrantRequest,
} from "./harness-authorizer.js";
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
  ActorIdentity,
  AuthConfig,
  SessionPayload,
  SessionSigningOptions,
  SessionVerificationOptions,
  AgentCredential,
  AuthEnvelope,
  AuthGrant,
  AuthGrantRequirement,
  AuthContext,
  AuthResolverDeps,
  CredentialProof,
  DelegationLink,
  ExecutionIdentity,
} from "./types.js";
export type {
  RuntimeGrantAuthorizerRequest,
  RuntimeGrantAuthorizationResult,
  RuntimeGrantSupplier,
} from "./runtime-authorizer.js";
export type { HarnessGrantAuthorizationRequest } from "./harness-authorizer.js";
