import { randomBytes } from "node:crypto";
import { signSession } from "./session.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface OAuthProvider {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

export interface OAuthConfig {
  providers: OAuthProvider[];
  callbackPath?: string; // default: /auth/callback
  sessionSecret: string;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
}

interface OAuthUserInfo {
  id?: string;
  sub?: string;
  email?: string;
  name?: string;
  login?: string;
}

// ── Pre-built providers ───────────────────────────────────────────────

/** Pre-built Google OAuth provider */
export function googleProvider(opts: {
  clientId: string;
  clientSecret: string;
}): OAuthProvider {
  return {
    name: "google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    scopes: ["openid", "email", "profile"],
  };
}

/** Pre-built GitHub OAuth provider */
export function githubProvider(opts: {
  clientId: string;
  clientSecret: string;
}): OAuthProvider {
  return {
    name: "github",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    scopes: ["user:email"],
  };
}

// ── State management ──────────────────────────────────────────────────

/** Generate a cryptographically random state parameter. */
function generateState(): string {
  return randomBytes(32).toString("hex");
}

// ── Cookie helpers ────────────────────────────────────────────────────

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

// ── OAuth handlers ────────────────────────────────────────────────────

export interface OAuthHandlers {
  /** GET /auth/login/:provider — redirect to OAuth provider */
  login: (request: Request, providerName: string) => Response;
  /** GET /auth/callback — handle OAuth callback, create session */
  callback: (request: Request) => Promise<Response>;
}

/**
 * Create OAuth route handlers.
 * Returns handlers for:
 * - GET /auth/login/:provider — redirect to OAuth provider
 * - GET /auth/callback — handle OAuth callback, create session
 */
export function createOAuthHandlers(
  config: OAuthConfig,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): OAuthHandlers {
  const callbackPath = config.callbackPath ?? "/auth/callback";
  const providerMap = new Map<string, OAuthProvider>();
  for (const p of config.providers) {
    providerMap.set(p.name, p);
  }

  function login(request: Request, providerName: string): Response {
    const provider = providerMap.get(providerName);
    if (!provider) {
      return new Response(
        JSON.stringify({ error: `Unknown provider: ${providerName}` }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    const state = generateState();
    const url = new URL(request.url);
    const redirectUri = `${url.origin}${callbackPath}`;

    const authorizeUrl = new URL(provider.authorizeUrl);
    authorizeUrl.searchParams.set("client_id", provider.clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", provider.scopes.join(" "));
    authorizeUrl.searchParams.set(
      "state",
      `${providerName}:${state}`,
    );

    return new Response(null, {
      status: 302,
      headers: {
        location: authorizeUrl.toString(),
        "set-cookie": `capstan_oauth_state=${providerName}:${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      },
    });
  }

  async function callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateParam = url.searchParams.get("state");

    if (!code || !stateParam) {
      return new Response(
        JSON.stringify({ error: "Missing code or state parameter" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    // Validate state against cookie
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookies = parseCookies(cookieHeader);
    const storedState = cookies.get("capstan_oauth_state");

    if (!storedState || storedState !== stateParam) {
      return new Response(
        JSON.stringify({ error: "Invalid state parameter" }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }

    // Extract provider name from state
    const colonIndex = stateParam.indexOf(":");
    if (colonIndex === -1) {
      return new Response(
        JSON.stringify({ error: "Malformed state parameter" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const providerName = stateParam.slice(0, colonIndex);
    const provider = providerMap.get(providerName);

    if (!provider) {
      return new Response(
        JSON.stringify({ error: `Unknown provider: ${providerName}` }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    // Exchange code for access token
    const redirectUri = `${url.origin}${callbackPath}`;
    let tokenData: OAuthTokenResponse;
    try {
      const tokenResponse = await fetchFn(provider.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Token exchange failed" }),
          { status: 502, headers: { "content-type": "application/json" } },
        );
      }

      tokenData = (await tokenResponse.json()) as OAuthTokenResponse;
    } catch {
      return new Response(
        JSON.stringify({ error: "Token exchange failed" }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }

    if (!tokenData.access_token) {
      return new Response(
        JSON.stringify({ error: "Token exchange failed" }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }

    // Fetch user info
    let userInfo: OAuthUserInfo;
    try {
      const userResponse = await fetchFn(provider.userInfoUrl, {
        headers: {
          authorization: `Bearer ${tokenData.access_token}`,
          accept: "application/json",
        },
      });

      if (!userResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch user info" }),
          { status: 502, headers: { "content-type": "application/json" } },
        );
      }

      userInfo = (await userResponse.json()) as OAuthUserInfo;
    } catch {
      return new Response(
        JSON.stringify({ error: "Failed to fetch user info" }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }

    // Build session from user info
    const userId =
      userInfo.sub ?? userInfo.id?.toString() ?? userInfo.login ?? "unknown";
    const sessionData: Parameters<typeof signSession>[0] = {
      userId: `${providerName}:${userId}`,
    };
    if (userInfo.email !== undefined) {
      sessionData.email = userInfo.email;
    }
    const sessionToken = signSession(sessionData, config.sessionSecret);

    // Set session cookie and redirect to /
    return new Response(null, {
      status: 302,
      headers: {
        location: "/",
        "set-cookie": `capstan_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
      },
    });
  }

  return { login, callback };
}
