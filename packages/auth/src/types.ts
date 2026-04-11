export type AuthContextType = "human" | "agent" | "anonymous" | "workload";

export type ActorKind = "user" | "agent" | "workload" | "system" | "anonymous";

export type CredentialKind =
  | "session"
  | "oauth"
  | "api_key"
  | "mtls"
  | "dpop"
  | "run_token"
  | "approval_token"
  | "anonymous";

export type ExecutionKind =
  | "request"
  | "run"
  | "tool_call"
  | "approval"
  | "schedule"
  | "release"
  | "mcp_invocation";

export interface AuthCookieConfig {
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface AuthGrant {
  resource: string;
  action: string;
  scope?: Record<string, string>;
  effect?: "allow" | "deny";
  expiresAt?: string;
  constraints?: Record<string, unknown>;
}

export interface AuthGrantRequirement {
  resource: string;
  action: string;
  scope?: Record<string, string>;
}

export interface ActorIdentity {
  kind: ActorKind;
  id: string;
  displayName?: string;
  role?: string;
  email?: string;
  claims?: Record<string, unknown>;
}

export interface CredentialProof {
  kind: CredentialKind;
  subjectId: string;
  presentedAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionIdentity {
  kind: ExecutionKind;
  id: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export interface DelegationTargetRef {
  kind: ActorKind | ExecutionKind;
  id: string;
}

export interface DelegationLink {
  from: DelegationTargetRef;
  to: DelegationTargetRef;
  reason: string;
  issuedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AuthEnvelope {
  actor: ActorIdentity;
  credential: CredentialProof;
  execution?: ExecutionIdentity;
  delegation: DelegationLink[];
  grants: AuthGrant[];
}

export interface AuthConfig {
  session: {
    secret: string;
    maxAge?: string; // e.g. "7d", "1h"
    issuer?: string;
    audience?: string;
    cookieName?: string;
    cookie?: AuthCookieConfig;
  };
  apiKeys?: {
    prefix?: string; // e.g. "cap_ak_"
    headerName?: string; // default "Authorization"
  };
  /** Trusted SPIFFE trust domains for mTLS workload authentication. */
  trustedDomains?: string[];
  /** Whether to require client certificates (mTLS). */
  mtls?: boolean;
  /** OAuth 2.0 provider configuration for Google, GitHub, etc. */
  oauth?: import("./oauth.js").OAuthConfig;
}

export interface SessionPayload {
  userId: string;
  email?: string;
  role?: string;
  displayName?: string;
  permissions?: string[];
  claims?: Record<string, unknown>;
  sessionId?: string;
  iss?: string;
  aud?: string | string[];
  iat: number;
  exp: number;
}

export interface SessionSigningOptions {
  maxAge?: string;
  issuer?: string;
  audience?: string | string[];
}

export interface SessionVerificationOptions {
  issuer?: string;
  audience?: string;
}

export interface AgentCredential {
  id: string;
  name: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
  permissions: string[];
  grants?: AuthGrant[];
  claims?: Record<string, unknown>;
  revokedAt?: string;
}

export interface AuthContext {
  isAuthenticated: boolean;
  type: AuthContextType;
  actor: ActorIdentity;
  credential: CredentialProof;
  execution?: ExecutionIdentity;
  delegation: DelegationLink[];
  grants: AuthGrant[];
  envelope?: AuthEnvelope;
  userId?: string;
  role?: string;
  email?: string;
  agentId?: string;
  agentName?: string;
  permissions?: string[];
  /** DPoP key thumbprint — present when the request included a valid DPoP proof. */
  dpopThumbprint?: string;
  /** SPIFFE ID from client certificate (e.g. "spiffe://example.org/agent/crawler"). */
  spiffeId?: string;
  /** Client certificate fingerprint (SHA-256 hex digest). */
  certFingerprint?: string;
}

export interface AuthResolverDeps {
  /** Look up an agent credential by API key prefix */
  findAgentByKeyPrefix?: (
    prefix: string,
  ) => Promise<AgentCredential | null>;
  /** Resolve extra grants after credential verification. */
  resolveAdditionalGrants?: (
    auth: AuthContext,
    request: Request,
  ) => Promise<AuthGrant[] | string[] | undefined>;
  /** Attach richer execution identity to the resolved auth envelope. */
  resolveExecution?: (
    auth: AuthContext,
    request: Request,
  ) => Promise<ExecutionIdentity | undefined>;
  /** Attach delegation provenance for runtime / harness flows. */
  resolveDelegation?: (
    auth: AuthContext,
    request: Request,
  ) => Promise<DelegationLink[] | undefined>;
}
