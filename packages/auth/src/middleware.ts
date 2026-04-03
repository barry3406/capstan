import type {
  AuthConfig,
  AuthContext,
  AuthEnvelope,
  AuthGrant,
  AuthResolverDeps,
  CredentialProof,
} from "./types.js";
import { verifySession } from "./session.js";
import { verifyApiKey, extractApiKeyPrefix } from "./api-key.js";
import { validateDpopProof } from "./dpop.js";
import { extractWorkloadIdentity } from "./workload.js";
import {
  normalizePermissionsToGrants,
  serializeGrantsToPermissions,
} from "./permissions.js";
import { createRequestExecution } from "./execution.js";

const DEFAULT_API_KEY_PREFIX = "cap_ak_";
const ANONYMOUS_CONTEXT: AuthContext = {
  isAuthenticated: false,
  type: "anonymous",
  actor: {
    kind: "anonymous",
    id: "anonymous",
    displayName: "Anonymous",
  },
  credential: {
    kind: "anonymous",
    subjectId: "anonymous",
    presentedAt: new Date(0).toISOString(),
  },
  delegation: [],
  grants: [],
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
  const sessionCookieName = config.session.cookieName ?? "capstan_session";

  function syncEnvelope(authCtx: AuthContext): AuthContext {
    const envelope: AuthEnvelope = {
      actor: authCtx.actor,
      credential: authCtx.credential,
      delegation: authCtx.delegation,
      grants: authCtx.grants,
    };
    if (authCtx.execution !== undefined) {
      envelope.execution = authCtx.execution;
    }
    authCtx.envelope = envelope;
    return authCtx;
  }

  async function enrichContext(
    authCtx: AuthContext,
    request: Request,
  ): Promise<AuthContext> {
    const extraGrants = await deps.resolveAdditionalGrants?.(authCtx, request);
    if (extraGrants && extraGrants.length > 0) {
      authCtx.grants = [...authCtx.grants, ...normalizePermissionsToGrants(extraGrants)];
      authCtx.permissions = serializeGrantsToPermissions(authCtx.grants);
    }
    const execution =
      (await deps.resolveExecution?.(authCtx, request)) ??
      createRequestExecution(request);
    authCtx.execution = execution;
    const delegation = await deps.resolveDelegation?.(authCtx, request);
    if (delegation && delegation.length > 0) {
      authCtx.delegation = delegation;
    }
    return syncEnvelope(authCtx);
  }

  function createCredential(
    kind: CredentialProof["kind"],
    subjectId: string,
    options?: {
      expiresAt?: string;
      metadata?: Record<string, unknown>;
    },
  ): CredentialProof {
    const credential: CredentialProof = {
      kind,
      subjectId,
      presentedAt: new Date().toISOString(),
    };
    if (options?.expiresAt !== undefined) credential.expiresAt = options.expiresAt;
    if (options?.metadata !== undefined) credential.metadata = options.metadata;
    return credential;
  }

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
          actor: {
            kind: "workload",
            id: identity.spiffeId,
            displayName: identity.workloadPath,
          },
          credential: createCredential("mtls", identity.spiffeId, {
            metadata: {
              certFingerprint: identity.certFingerprint,
              trustDomain: identity.trustDomain,
              workloadPath: identity.workloadPath,
            },
          }),
          delegation: [],
          grants: [],
          spiffeId: identity.spiffeId,
          certFingerprint: identity.certFingerprint,
        };
      }
    }

    // ── 2. Session cookie ────────────────────────────────────────
    const cookieHeader = request.headers.get("cookie");
    if (!authCtx && cookieHeader) {
      const cookies = parseCookies(cookieHeader);
      const sessionToken = cookies.get(sessionCookieName);

      if (sessionToken) {
        const payload = verifySession(sessionToken, config.session.secret, {
          ...(config.session.issuer !== undefined
            ? { issuer: config.session.issuer }
            : {}),
          ...(config.session.audience !== undefined
            ? { audience: config.session.audience }
            : {}),
        });
        if (payload) {
          const grants = normalizePermissionsToGrants(payload.permissions ?? []);
          const ctx: AuthContext = {
            isAuthenticated: true,
            type: "human",
            actor: {
              kind: "user",
              id: payload.userId,
              ...(payload.displayName !== undefined
                ? { displayName: payload.displayName }
                : {}),
              ...(payload.role !== undefined ? { role: payload.role } : {}),
              ...(payload.email !== undefined ? { email: payload.email } : {}),
              ...(payload.claims !== undefined ? { claims: payload.claims } : {}),
            },
            credential: createCredential("session", payload.userId, {
              expiresAt: new Date(payload.exp * 1000).toISOString(),
              metadata: {
                issuedAt: new Date(payload.iat * 1000).toISOString(),
                ...(payload.sessionId !== undefined
                  ? { sessionId: payload.sessionId }
                  : {}),
                ...(payload.iss !== undefined ? { issuer: payload.iss } : {}),
                ...(payload.aud !== undefined ? { audience: payload.aud } : {}),
              },
            }),
            delegation: [],
            grants,
            userId: payload.userId,
          };
          if (payload.role !== undefined) ctx.role = payload.role;
          if (payload.email !== undefined) ctx.email = payload.email;
          if (payload.permissions !== undefined) ctx.permissions = [...payload.permissions];
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
              const grants = normalizePermissionsToGrants([
                ...credential.permissions,
                ...(credential.grants ?? []),
              ]);
              authCtx = {
                isAuthenticated: true,
                type: "agent",
                actor: {
                  kind: "agent",
                  id: credential.id,
                  displayName: credential.name,
                  ...(credential.claims !== undefined
                    ? { claims: credential.claims }
                    : {}),
                },
                credential: createCredential("api_key", credential.id),
                delegation: [],
                grants,
                agentId: credential.id,
                agentName: credential.name,
                permissions: serializeGrantsToPermissions(grants),
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
        return syncEnvelope({ ...ANONYMOUS_CONTEXT });
      }

      // Bind the DPoP thumbprint to the auth context.
      authCtx.dpopThumbprint = result.thumbprint;
      authCtx.credential = createCredential("dpop", authCtx.actor.id, {
        ...(authCtx.credential.expiresAt !== undefined
          ? { expiresAt: authCtx.credential.expiresAt }
          : {}),
        metadata: {
          ...(authCtx.credential.metadata ?? {}),
          thumbprint: result.thumbprint,
          boundCredentialKind: authCtx.credential.kind,
        },
      });
    }

    // ── 5. Anonymous ─────────────────────────────────────────────
    if (!authCtx) {
      return enrichContext(
        {
          ...ANONYMOUS_CONTEXT,
          credential: {
            ...ANONYMOUS_CONTEXT.credential,
            presentedAt: new Date().toISOString(),
          },
        },
        request,
      );
    }
    return enrichContext(authCtx, request);
  };
}
