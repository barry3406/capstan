import { describe, it, expect, mock } from "bun:test";
import {
  googleProvider,
  githubProvider,
  createOAuthHandlers,
  verifySession,
} from "@zauso-ai/capstan-auth";
import type { OAuthConfig } from "@zauso-ai/capstan-auth";

const TEST_SECRET = "oauth-test-secret-key-for-capstan";

// ── Helper ────────────────────────────────────────────────────────────

function buildConfig(
  providers = [
    googleProvider({ clientId: "gid", clientSecret: "gsec" }),
    githubProvider({ clientId: "ghid", clientSecret: "ghsec" }),
  ],
): OAuthConfig {
  return { providers, sessionSecret: TEST_SECRET };
}

function mockFetch(responses: Array<{ ok: boolean; json: () => unknown }>) {
  let callIndex = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url.toString(), init });
    const resp = responses[callIndex];
    callIndex++;
    if (!resp) {
      return { ok: false, json: async () => ({}) } as Response;
    }
    return {
      ok: resp.ok,
      json: async () => resp.json(),
    } as Response;
  };
  return { fn: fn as typeof globalThis.fetch, calls };
}

// ── googleProvider ────────────────────────────────────────────────────

describe("googleProvider", () => {
  it("returns correct authorize URL", () => {
    const p = googleProvider({ clientId: "c", clientSecret: "s" });
    expect(p.authorizeUrl).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("returns correct token URL", () => {
    const p = googleProvider({ clientId: "c", clientSecret: "s" });
    expect(p.tokenUrl).toBe("https://oauth2.googleapis.com/token");
  });

  it("returns correct user info URL", () => {
    const p = googleProvider({ clientId: "c", clientSecret: "s" });
    expect(p.userInfoUrl).toBe(
      "https://www.googleapis.com/oauth2/v3/userinfo",
    );
  });

  it("includes openid, email, and profile scopes", () => {
    const p = googleProvider({ clientId: "c", clientSecret: "s" });
    expect(p.scopes).toEqual(["openid", "email", "profile"]);
  });

  it("passes through clientId and clientSecret", () => {
    const p = googleProvider({ clientId: "my-id", clientSecret: "my-sec" });
    expect(p.clientId).toBe("my-id");
    expect(p.clientSecret).toBe("my-sec");
  });

  it("sets the provider name to google", () => {
    const p = googleProvider({ clientId: "c", clientSecret: "s" });
    expect(p.name).toBe("google");
  });
});

// ── githubProvider ────────────────────────────────────────────────────

describe("githubProvider", () => {
  it("returns correct authorize URL", () => {
    const p = githubProvider({ clientId: "c", clientSecret: "s" });
    expect(p.authorizeUrl).toBe(
      "https://github.com/login/oauth/authorize",
    );
  });

  it("returns correct token URL", () => {
    const p = githubProvider({ clientId: "c", clientSecret: "s" });
    expect(p.tokenUrl).toBe(
      "https://github.com/login/oauth/access_token",
    );
  });

  it("returns correct user info URL", () => {
    const p = githubProvider({ clientId: "c", clientSecret: "s" });
    expect(p.userInfoUrl).toBe("https://api.github.com/user");
  });

  it("includes user:email scope", () => {
    const p = githubProvider({ clientId: "c", clientSecret: "s" });
    expect(p.scopes).toEqual(["user:email"]);
  });

  it("sets the provider name to github", () => {
    const p = githubProvider({ clientId: "c", clientSecret: "s" });
    expect(p.name).toBe("github");
  });
});

// ── createOAuthHandlers ───────────────────────────────────────────────

describe("createOAuthHandlers", () => {
  it("returns login and callback handler functions", () => {
    const handlers = createOAuthHandlers(buildConfig());
    expect(typeof handlers.login).toBe("function");
    expect(typeof handlers.callback).toBe("function");
  });
});

// ── login handler ─────────────────────────────────────────────────────

describe("login handler", () => {
  it("redirects with 302 for a known provider", () => {
    const { login } = createOAuthHandlers(buildConfig());
    const req = new Request("http://localhost:3000/auth/login/google");
    const res = login(req, "google");
    expect(res.status).toBe(302);
  });

  it("builds correct Google authorize URL params", () => {
    const { login } = createOAuthHandlers(buildConfig());
    const req = new Request("http://localhost:3000/auth/login/google");
    const res = login(req, "google");
    const location = new URL(res.headers.get("location")!);

    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location.searchParams.get("client_id")).toBe("gid");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/auth/callback",
    );
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("openid email profile");
  });

  it("includes a state parameter with the provider name prefix", () => {
    const { login } = createOAuthHandlers(buildConfig());
    const req = new Request("http://localhost:3000/auth/login/google");
    const res = login(req, "google");
    const location = new URL(res.headers.get("location")!);
    const state = location.searchParams.get("state")!;

    expect(state.startsWith("google:")).toBe(true);
    // The hex portion after "google:" should be 64 chars (32 bytes)
    expect(state.slice("google:".length).length).toBe(64);
  });

  it("sets an oauth state cookie", () => {
    const { login } = createOAuthHandlers(buildConfig());
    const req = new Request("http://localhost:3000/auth/login/github");
    const res = login(req, "github");
    const cookie = res.headers.get("set-cookie")!;

    expect(cookie).toContain("capstan_oauth_state=github:");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("returns 400 for an unknown provider", () => {
    const { login } = createOAuthHandlers(buildConfig());
    const req = new Request("http://localhost:3000/auth/login/twitter");
    const res = login(req, "twitter");
    expect(res.status).toBe(400);
  });

  it("respects custom callbackPath", () => {
    const config = buildConfig();
    config.callbackPath = "/custom/cb";
    const { login } = createOAuthHandlers(config);
    const req = new Request("http://localhost:3000/auth/login/google");
    const res = login(req, "google");
    const location = new URL(res.headers.get("location")!);

    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/custom/cb",
    );
  });
});

// ── callback handler ──────────────────────────────────────────────────

describe("callback handler", () => {
  function callbackRequest(
    params: Record<string, string>,
    cookie?: string,
  ): Request {
    const url = new URL("http://localhost:3000/auth/callback");
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {};
    if (cookie) headers["cookie"] = cookie;
    return new Request(url.toString(), { headers });
  }

  it("exchanges code for token and fetches user info (Google-style sub)", async () => {
    const state = "google:" + "a".repeat(64);
    const { fn, calls } = mockFetch([
      {
        ok: true,
        json: () => ({ access_token: "tok_123", token_type: "bearer" }),
      },
      {
        ok: true,
        json: () => ({
          sub: "112233",
          email: "user@gmail.com",
          name: "Test User",
        }),
      },
    ]);

    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest(
      { code: "authcode", state },
      `capstan_oauth_state=${state}`,
    );
    const res = await callback(req);

    // Should redirect to /
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");

    // Should have called token and userinfo endpoints
    expect(calls.length).toBe(2);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[1]!.url).toBe(
      "https://www.googleapis.com/oauth2/v3/userinfo",
    );

    // Session cookie should be set
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("capstan_session=");
    expect(setCookie).toContain("HttpOnly");

    // Extract and verify the session token
    const tokenMatch = setCookie.match(/capstan_session=([^;]+)/);
    expect(tokenMatch).not.toBeNull();
    const payload = verifySession(tokenMatch![1]!, TEST_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("google:112233");
    expect(payload!.email).toBe("user@gmail.com");
  });

  it("handles GitHub-style user info (id + login, no sub)", async () => {
    const state = "github:" + "b".repeat(64);
    const { fn } = mockFetch([
      {
        ok: true,
        json: () => ({ access_token: "ghp_abc", token_type: "bearer" }),
      },
      {
        ok: true,
        json: () => ({
          id: 42,
          login: "octocat",
          email: "octocat@github.com",
        }),
      },
    ]);

    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest(
      { code: "ghcode", state },
      `capstan_oauth_state=${state}`,
    );
    const res = await callback(req);

    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie")!;
    const tokenMatch = setCookie.match(/capstan_session=([^;]+)/);
    const payload = verifySession(tokenMatch![1]!, TEST_SECRET);
    expect(payload).not.toBeNull();
    // id.toString() takes precedence over login when sub is absent
    expect(payload!.userId).toBe("github:42");
    expect(payload!.email).toBe("octocat@github.com");
  });

  it("returns 403 for invalid state (no cookie)", async () => {
    const { fn } = mockFetch([]);
    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const state = "google:" + "c".repeat(64);
    const req = callbackRequest({ code: "authcode", state });
    const res = await callback(req);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid state parameter");
  });

  it("returns 403 for mismatched state", async () => {
    const { fn } = mockFetch([]);
    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const state = "google:" + "d".repeat(64);
    const otherState = "google:" + "e".repeat(64);
    const req = callbackRequest(
      { code: "authcode", state },
      `capstan_oauth_state=${otherState}`,
    );
    const res = await callback(req);

    expect(res.status).toBe(403);
  });

  it("returns 400 when code is missing", async () => {
    const { fn } = mockFetch([]);
    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest({ state: "google:abc" });
    const res = await callback(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Missing code or state parameter");
  });

  it("returns 400 when state is missing", async () => {
    const { fn } = mockFetch([]);
    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest({ code: "authcode" });
    const res = await callback(req);

    expect(res.status).toBe(400);
  });

  it("returns 502 when token exchange fails (non-ok response)", async () => {
    const state = "google:" + "f".repeat(64);
    const { fn } = mockFetch([{ ok: false, json: () => ({}) }]);
    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest(
      { code: "authcode", state },
      `capstan_oauth_state=${state}`,
    );
    const res = await callback(req);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Token exchange failed");
  });

  it("returns 502 when token response has no access_token", async () => {
    const state = "google:" + "g".repeat(64);
    const { fn } = mockFetch([
      { ok: true, json: () => ({ error: "bad_code" }) },
    ]);
    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest(
      { code: "authcode", state },
      `capstan_oauth_state=${state}`,
    );
    const res = await callback(req);

    expect(res.status).toBe(502);
  });

  it("returns 502 when user info fetch fails", async () => {
    const state = "google:" + "h".repeat(64);
    const { fn } = mockFetch([
      {
        ok: true,
        json: () => ({ access_token: "tok", token_type: "bearer" }),
      },
      { ok: false, json: () => ({}) },
    ]);
    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest(
      { code: "authcode", state },
      `capstan_oauth_state=${state}`,
    );
    const res = await callback(req);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Failed to fetch user info");
  });

  it("sends correct token exchange body parameters", async () => {
    const state = "google:" + "i".repeat(64);
    const { fn, calls } = mockFetch([
      {
        ok: true,
        json: () => ({ access_token: "tok", token_type: "bearer" }),
      },
      {
        ok: true,
        json: () => ({ sub: "u1", email: "a@b.com" }),
      },
    ]);

    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest(
      { code: "mycode", state },
      `capstan_oauth_state=${state}`,
    );
    await callback(req);

    const tokenCall = calls[0]!;
    const body = new URLSearchParams(tokenCall.init?.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("mycode");
    expect(body.get("client_id")).toBe("gid");
    expect(body.get("client_secret")).toBe("gsec");
    expect(body.get("redirect_uri")).toBe(
      "http://localhost:3000/auth/callback",
    );
  });

  it("sends Bearer token when fetching user info", async () => {
    const state = "google:" + "j".repeat(64);
    const { fn, calls } = mockFetch([
      {
        ok: true,
        json: () => ({ access_token: "my_token_123", token_type: "bearer" }),
      },
      {
        ok: true,
        json: () => ({ sub: "u1" }),
      },
    ]);

    const { callback } = createOAuthHandlers(buildConfig(), fn);
    const req = callbackRequest(
      { code: "c", state },
      `capstan_oauth_state=${state}`,
    );
    await callback(req);

    const userInfoCall = calls[1]!;
    const authHeader = (userInfoCall.init?.headers as Record<string, string>)[
      "authorization"
    ];
    expect(authHeader).toBe("Bearer my_token_123");
  });
});
