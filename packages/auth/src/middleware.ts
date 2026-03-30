import type {
  AuthConfig,
  AuthContext,
  AuthResolverDeps,
} from "./types.js";
import { verifySession } from "./session.js";
import { verifyApiKey, extractApiKeyPrefix } from "./api-key.js";
import { validateDpopProof } from "./dpop.js";
import { extractWorkloadIdentity } from "./workload.js";

const SESSION_COOKIE_NAME = "capstan_session";
const DEFAULT_API_KEY_PREFIX = "cap_ak_";
const ANONYMOUS_CONTEXT: AuthContext = {
  isAuthenticated: false,
  type: "anonymous",
};

// ── Cookie helpers ─────────────────────────────────────────────────

function parseCookies(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of header.split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const name = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    cookies.set(name, value);
  }
  return cookies;
}

// ── Middleware factory ──────────────────────────────────────────────

/**
 * Create a middleware function that resolves an `AuthContext` from an
 * incoming `Request`.
 *
 * Resolution order:
 * 1. Client certificate / workload identity (`X-Client-Cert` or
 *    `X-Forwarded-Client-Cert` header) — extracts SPIFFE ID, validates
 *    trust domain, returns workload context.
 * 2. Session cookie (`capstan_session`) — verifies JWT, returns human context.
 * 3. `Authorization: Bearer <token>` header — if the token matches the
 *    configured API key prefix, looks up the agent credential and verifies
 *    the key hash.
 * 4. Falls back to `{ type: "anonymous", isAuthenticated: false }`.
 */
export function createAuthMiddleware(
  config: AuthConfig,
  deps: AuthResolverDeps,
): (request: Request) => Promise<AuthContext> {
  const apiKeyPrefix = config.apiKeys?.prefix ?? DEFAULT_API_KEY_PREFIX;
  const authHeaderName = config.apiKeys?.headerName ?? "Authorization";
  const trustedDomains = config.trustedDomains ?? [];

  return async (request: Request): Promise<AuthContext> => {
    let authCtx: AuthContext | undefined;
    let accessToken: string | undefined;

    // ── 1. Workload identity (mTLS / SPIFFE) ─────────────────────
    if (trustedDomains.length > 0) {
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of request.headers.entries()) {
        headers[key] = value;
      }

      const identity = extractWorkloadIdentity(headers, trustedDomains);
      if (identity) {
        authCtx = {
          isAuthenticated: true,
          type: "workload",
          spiffeId: identity.spiffeId,
          certFingerprint: identity.certFingerprint,
        };
      }
    }

    // ── 2. Session cookie ────────────────────────────────────────
    const cookieHeader = request.headers.get("cookie");
    if (!authCtx && cookieHeader) {
      const cookies = parseCookies(cookieHeader);
      const sessionToken = cookies.get(SESSION_COOKIE_NAME);

      if (sessionToken) {
        const payload = verifySession(sessionToken, config.session.secret);
        if (payload) {
          const ctx: AuthContext = {
            isAuthenticated: true,
            type: "human",
            userId: payload.userId,
          };
          if (payload.role !== undefined) ctx.role = payload.role;
          if (payload.email !== undefined) ctx.email = payload.email;
          authCtx = ctx;
          accessToken = sessionToken;
        }
      }
    }

    // ── 3. API key via Authorization header ──────────────────────
    if (!authCtx) {
      const authHeader = request.headers.get(authHeaderName);
      if (authHeader) {
        const token = authHeader.startsWith("Bearer ")
          ? authHeader.slice(7)
          : authHeader.startsWith("DPoP ")
            ? authHeader.slice(5)
            : null;

        if (token && token.startsWith(apiKeyPrefix) && deps.findAgentByKeyPrefix) {
          const prefix = extractApiKeyPrefix(token);
          const credential = await deps.findAgentByKeyPrefix(prefix);

          if (credential && !credential.revokedAt) {
            const valid = await verifyApiKey(token, credential.apiKeyHash);
            if (valid) {
              authCtx = {
                isAuthenticated: true,
                type: "agent",
                agentId: credential.id,
                agentName: credential.name,
                permissions: credential.permissions,
              };
              accessToken = token;
            }
          }
        }
      }
    }

    // ── 4. DPoP proof validation ─────────────────────────────────
    // If a DPoP header is present, validate the proof and bind the
    // token to the key thumbprint.  A missing or invalid proof when
    // the header is present causes the auth context to be rejected.
    const dpopHeader = request.headers.get("dpop");
    if (dpopHeader && authCtx) {
      const result = await validateDpopProof(
        dpopHeader,
        request.method,
        request.url,
        accessToken,
      );

      if (!result) {
        // DPoP proof failed validation — treat as unauthenticated.
        return ANONYMOUS_CONTEXT;
      }

      // Bind the DPoP thumbprint to the auth context.
      authCtx.dpopThumbprint = result.thumbprint;
    }

    // ── 5. Anonymous ─────────────────────────────────────────────
    return authCtx ?? ANONYMOUS_CONTEXT;
  };
}
