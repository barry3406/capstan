export interface AuthConfig {
  session: {
    secret: string;
    maxAge?: string; // e.g. "7d", "1h"
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
  iat: number;
  exp: number;
}

export interface AgentCredential {
  id: string;
  name: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
  permissions: string[];
  revokedAt?: string;
}

export interface AuthContext {
  isAuthenticated: boolean;
  type: "human" | "agent" | "anonymous" | "workload";
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
}
