import { describe, it, expect, beforeEach } from "bun:test";
import {
  createAuthMiddleware,
  createGrant,
  generateApiKey,
  signSession,
} from "@zauso-ai/capstan-auth";
import type { AuthConfig } from "@zauso-ai/capstan-auth";

const SECRET = "auth-middleware-v2-secret";

function buildConfig(): AuthConfig {
  return {
    session: {
      secret: SECRET,
      cookieName: "capstan_session",
      issuer: "capstan",
      audience: "capstan-web",
    },
    apiKeys: {
      prefix: "cap_ak_",
    },
    trustedDomains: ["example.org"],
  };
}

function buildWorkloadRequest(url: string): Request {
  const pem = [
    "-----BEGIN CERTIFICATE-----",
    "MIIBkTCB+wIJALRiMLAh0GRIMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnNl",
    "cnZlcjAeFw0yNDAxMDEwMDAwMDBaFw0yNTAxMDEwMDAwMDBaMBExDzANBgNVBAMM",
    "BnNlcnZlcjBcMA0GCSqGSIb3DQEBAQUAAktAMEgCQQDK",
    "-----END CERTIFICATE-----",
  ].join("\n");

  return new Request(url, {
    headers: {
      "X-Forwarded-Client-Cert":
        `URI=spiffe://example.org/agent/crawler;Cert="${encodeURIComponent(pem)}"`,
      cookie: "capstan_session=ignored",
      authorization: "Bearer ignored",
    },
  });
}

async function buildDpopProof(method: string, url: string, accessToken: string): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = { typ: "dpop+jwt", alg: "RS256", jwk: pubJwk };
  const payload = {
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
    jti: `jti-${Math.random().toString(36).slice(2)}`,
    ath: Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken)),
    ).toString("base64url"),
  };
  const headerB64 = Buffer.from(JSON.stringify(header), "utf-8").toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  const sigB64 = Buffer.from(sigBuf).toString("base64url");
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

describe("createAuthMiddleware v2", () => {
  beforeEach(() => {
    // Keep request-based tests isolated.
  });

  it("promotes session cookies into the richer human auth shape", async () => {
    const token = signSession(
      {
        userId: "user-1",
        email: "user@example.com",
        role: "admin",
        displayName: "Ada",
        permissions: ["audit:read", "approval:manage"],
        sessionId: "sess-1",
      },
      SECRET,
      {
        maxAge: "1h",
        issuer: "capstan",
        audience: "capstan-web",
      },
    );

    const middleware = createAuthMiddleware(buildConfig(), {});
    const ctx = await middleware(
      new Request("https://capstan.example/dashboard", {
        headers: { cookie: `capstan_session=${token}` },
      }),
    );

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.type).toBe("human");
    expect(ctx.actor).toMatchObject({
      kind: "user",
      id: "user-1",
      displayName: "Ada",
      role: "admin",
      email: "user@example.com",
    });
    expect(ctx.credential.kind).toBe("session");
    expect(ctx.credential.subjectId).toBe("user-1");
    expect(ctx.execution?.kind).toBe("request");
    expect(ctx.execution?.metadata).toMatchObject({
      method: "GET",
      pathname: "/dashboard",
      origin: "https://capstan.example",
    });
    expect(ctx.userId).toBe("user-1");
    expect(ctx.role).toBe("admin");
    expect(ctx.email).toBe("user@example.com");
    expect(ctx.permissions).toEqual(["audit:read", "approval:manage"]);
    expect(ctx.grants.map((grant) => `${grant.resource}:${grant.action}`)).toEqual([
      "audit:read",
      "approval:manage",
    ]);
  });

  it("projects API key credentials into agent identity and scoped grants", async () => {
    const { key, hash, prefix } = generateApiKey();
    const middleware = createAuthMiddleware(buildConfig(), {
      findAgentByKeyPrefix: async (lookupPrefix) => {
        if (lookupPrefix !== prefix) return null;
        return {
          id: "agent-1",
          name: "Planner",
          apiKeyHash: hash,
          apiKeyPrefix: prefix,
          permissions: ["run:resume"],
          grants: [createGrant("artifact", "read", { scope: { runId: "run-1" } })],
          claims: { team: "automation" },
        };
      },
    });

    const ctx = await middleware(
      new Request("https://capstan.example/api/runs/run-1", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.type).toBe("agent");
    expect(ctx.actor).toMatchObject({
      kind: "agent",
      id: "agent-1",
      displayName: "Planner",
      claims: { team: "automation" },
    });
    expect(ctx.credential.kind).toBe("api_key");
    expect(ctx.grants.map((grant) => `${grant.resource}:${grant.action}`)).toEqual([
      "run:resume",
      "artifact:read",
    ]);
    expect(ctx.permissions).toEqual(["run:resume", "artifact:read"]);
    expect(ctx.agentId).toBe("agent-1");
    expect(ctx.agentName).toBe("Planner");
  });

  it("binds a DPoP proof to the resolved credential", async () => {
    const { key, hash, prefix } = generateApiKey();
    const accessToken = key;
    const proof = await buildDpopProof(
      "GET",
      "https://capstan.example/api/runs/run-1",
      accessToken,
    );

    const middleware = createAuthMiddleware(buildConfig(), {
      findAgentByKeyPrefix: async (lookupPrefix) => {
        if (lookupPrefix !== prefix) return null;
        return {
          id: "agent-1",
          name: "Planner",
          apiKeyHash: hash,
          apiKeyPrefix: prefix,
          permissions: ["run:read"],
        };
      },
    });

    const ctx = await middleware(
      new Request("https://capstan.example/api/runs/run-1", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          DPoP: proof,
        },
      }),
    );

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.credential.kind).toBe("dpop");
    expect(ctx.dpopThumbprint).toBeDefined();
    expect(ctx.credential.metadata).toMatchObject({
      thumbprint: ctx.dpopThumbprint,
      boundCredentialKind: "api_key",
    });
  });

  it("prefers workload identity over other credentials and still adds execution context", async () => {
    const token = signSession(
      { userId: "user-1", permissions: ["audit:read"] },
      SECRET,
      { maxAge: "1h" },
    );
    const { key } = generateApiKey();
    const middleware = createAuthMiddleware(buildConfig(), {
      findAgentByKeyPrefix: async () => ({
        id: "agent-1",
        name: "Agent",
        apiKeyHash: "unused",
        apiKeyPrefix: "cap_ak_",
        permissions: [],
      }),
    });
    const request = buildWorkloadRequest("https://capstan.example/api/health");
    request.headers.set("cookie", `capstan_session=${token}`);
    request.headers.set("authorization", `Bearer ${key}`);

    const ctx = await middleware(request);

    expect(ctx.type).toBe("workload");
    expect(ctx.actor.kind).toBe("workload");
    expect(ctx.credential.kind).toBe("mtls");
    expect(ctx.spiffeId).toBe("spiffe://example.org/agent/crawler");
    expect(ctx.execution?.kind).toBe("request");
    expect(ctx.userId).toBeUndefined();
  });

  it("keeps anonymous requests usable and applies resolver hooks", async () => {
    const middleware = createAuthMiddleware(buildConfig(), {
      resolveAdditionalGrants: async () => [
        "audit:read",
        createGrant("run", "read", { scope: { runId: "run-1" } }),
      ],
      resolveExecution: async () => ({
        kind: "run",
        id: "run:run-1",
        metadata: { runId: "run-1" },
      }),
      resolveDelegation: async () => [
        {
          from: { kind: "user", id: "user-1" },
          to: { kind: "run", id: "run:run-1" },
          reason: "supervision session",
          issuedAt: "2025-04-01T00:00:00.000Z",
        },
      ],
    });

    const ctx = await middleware(new Request("https://capstan.example/public"));

    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.type).toBe("anonymous");
    expect(ctx.actor.kind).toBe("anonymous");
    expect(ctx.credential.kind).toBe("anonymous");
    expect(ctx.execution?.kind).toBe("run");
    expect(ctx.grants.map((grant) => `${grant.resource}:${grant.action}`)).toEqual([
      "audit:read",
      "run:read",
    ]);
    expect(ctx.delegation).toHaveLength(1);
  });
});
