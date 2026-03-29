import type {
  AuthConfig,
  AuthContext,
  AuthResolverDeps,
} from "./types.js";
import { verifySession } from "./session.js";
import { verifyApiKey, extractApiKeyPrefix } from "./api-key.js";

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
 * 1. Session cookie (`capstan_session`) — verifies JWT, returns human context.
 * 2. `Authorization: Bearer <token>` header — if the token matches the
 *    configured API key prefix, looks up the agent credential and verifies
 *    the key hash.
 * 3. Falls back to `{ type: "anonymous", isAuthenticated: false }`.
 */
export function createAuthMiddleware(
  config: AuthConfig,
  deps: AuthResolverDeps,
): (request: Request) => Promise<AuthContext> {
  const apiKeyPrefix = config.apiKeys?.prefix ?? DEFAULT_API_KEY_PREFIX;
  const authHeaderName = config.apiKeys?.headerName ?? "Authorization";

  return async (request: Request): Promise<AuthContext> => {
    // ── 1. Session cookie ────────────────────────────────────────
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
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
          return ctx;
        }
      }
    }

    // ── 2. API key via Authorization header ──────────────────────
    const authHeader = request.headers.get(authHeaderName);
    if (authHeader) {
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

      if (token && token.startsWith(apiKeyPrefix) && deps.findAgentByKeyPrefix) {
        const prefix = extractApiKeyPrefix(token);
        const credential = await deps.findAgentByKeyPrefix(prefix);

        if (credential && !credential.revokedAt) {
          const valid = await verifyApiKey(token, credential.apiKeyHash);
          if (valid) {
            return {
              isAuthenticated: true,
              type: "agent",
              agentId: credential.id,
              agentName: credential.name,
              permissions: credential.permissions,
            };
          }
        }
      }
    }

    // ── 3. Anonymous ─────────────────────────────────────────────
    return ANONYMOUS_CONTEXT;
  };
}
