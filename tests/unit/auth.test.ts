import { describe, it, expect } from "bun:test";
import {
  signSession,
  verifySession,
  generateApiKey,
  verifyApiKey,
  extractApiKeyPrefix,
  checkPermission,
  createAuthMiddleware,
} from "@zauso-ai/capstan-auth";

// ---------------------------------------------------------------------------
// signSession / verifySession
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-secret-key-for-capstan-auth-tests";

describe("signSession", () => {
  it("produces a valid JWT string with 3 dot-separated base64url segments", () => {
    const token = signSession({ userId: "user-1" }, TEST_SECRET);
    const parts = token.split(".");
    expect(parts.length).toBe(3);

    // Each part should be valid base64url
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
      // base64url characters: A-Z a-z 0-9 - _
      expect(/^[A-Za-z0-9_-]+$/.test(part)).toBe(true);
    }
  });

  it("encodes the userId in the payload", () => {
    const token = signSession({ userId: "user-42" }, TEST_SECRET);
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf-8"),
    );
    expect(payload.userId).toBe("user-42");
  });

  it("includes iat and exp claims", () => {
    const token = signSession({ userId: "u" }, TEST_SECRET);
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf-8"),
    );
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});

describe("verifySession", () => {
  it("validates a token signed with the same secret", () => {
    const token = signSession(
      { userId: "user-1", email: "test@example.com", role: "admin" },
      TEST_SECRET,
    );
    const payload = verifySession(token, TEST_SECRET);

    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-1");
    expect(payload!.email).toBe("test@example.com");
    expect(payload!.role).toBe("admin");
  });

  it("returns null for expired tokens", () => {
    // Sign with a very short maxAge that is already expired
    const token = signSession({ userId: "u" }, TEST_SECRET, "0s");
    const payload = verifySession(token, TEST_SECRET);
    expect(payload).toBeNull();
  });

  it("returns null for tampered tokens", () => {
    const token = signSession({ userId: "u" }, TEST_SECRET);
    // Tamper with the payload section
    const parts = token.split(".");
    const tampered = [parts[0], "dGFtcGVyZWQ", parts[2]].join(".");
    const payload = verifySession(tampered, TEST_SECRET);
    expect(payload).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    const token = signSession({ userId: "u" }, "secret-A");
    const payload = verifySession(token, "secret-B");
    expect(payload).toBeNull();
  });

  it("returns null for malformed tokens", () => {
    expect(verifySession("not.a.jwt.at.all", TEST_SECRET)).toBeNull();
    expect(verifySession("", TEST_SECRET)).toBeNull();
    expect(verifySession("abc", TEST_SECRET)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateApiKey / verifyApiKey / extractApiKeyPrefix
// ---------------------------------------------------------------------------

describe("generateApiKey", () => {
  it("produces a key with the default prefix", () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key.startsWith("cap_ak_")).toBe(true);
    expect(prefix.startsWith("cap_ak_")).toBe(true);
    expect(hash.length).toBe(64); // SHA-256 hex
  });

  it("produces a key with a custom prefix", () => {
    const { key, prefix } = generateApiKey("myapp_");
    expect(key.startsWith("myapp_")).toBe(true);
    expect(prefix.startsWith("myapp_")).toBe(true);
  });

  it("generates unique keys each time", () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();
    expect(k1.key).not.toBe(k2.key);
    expect(k1.hash).not.toBe(k2.hash);
  });
});

describe("verifyApiKey", () => {
  it("returns true for a correct key matching its hash", async () => {
    const { key, hash } = generateApiKey();
    const valid = await verifyApiKey(key, hash);
    expect(valid).toBe(true);
  });

  it("returns false for a wrong key", async () => {
    const { hash } = generateApiKey();
    const valid = await verifyApiKey("cap_ak_wrongkey1234567890abcdef", hash);
    expect(valid).toBe(false);
  });

  it("returns false for a tampered hash", async () => {
    const { key } = generateApiKey();
    const valid = await verifyApiKey(
      key,
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(valid).toBe(false);
  });
});

describe("extractApiKeyPrefix", () => {
  it("extracts the right prefix from a generated key", () => {
    const { key, prefix } = generateApiKey();
    const extracted = extractApiKeyPrefix(key);
    expect(extracted).toBe(prefix);
  });

  it("extracts prefix from a custom-prefixed key", () => {
    const { key, prefix } = generateApiKey("test_key_");
    const extracted = extractApiKeyPrefix(key);
    expect(extracted).toBe(prefix);
  });
});

// ---------------------------------------------------------------------------
// checkPermission
// ---------------------------------------------------------------------------

describe("checkPermission", () => {
  it("matches an exact permission", () => {
    const result = checkPermission(
      { resource: "ticket", action: "read" },
      ["ticket:read"],
    );
    expect(result).toBe(true);
  });

  it("matches a wildcard resource", () => {
    const result = checkPermission(
      { resource: "ticket", action: "write" },
      ["*:write"],
    );
    expect(result).toBe(true);
  });

  it("matches a wildcard action", () => {
    const result = checkPermission(
      { resource: "ticket", action: "delete" },
      ["ticket:*"],
    );
    expect(result).toBe(true);
  });

  it("matches full wildcard *:*", () => {
    const result = checkPermission(
      { resource: "ticket", action: "delete" },
      ["*:*"],
    );
    expect(result).toBe(true);
  });

  it("rejects when permission not granted", () => {
    const result = checkPermission(
      { resource: "ticket", action: "delete" },
      ["ticket:read", "comment:write"],
    );
    expect(result).toBe(false);
  });

  it("rejects when granted list is empty", () => {
    const result = checkPermission(
      { resource: "ticket", action: "read" },
      [],
    );
    expect(result).toBe(false);
  });

  it("skips malformed entries without colon", () => {
    const result = checkPermission(
      { resource: "ticket", action: "read" },
      ["malformed", "ticket:read"],
    );
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createAuthMiddleware
// ---------------------------------------------------------------------------

describe("createAuthMiddleware", () => {
  const authConfig = {
    session: { secret: TEST_SECRET },
    apiKeys: { prefix: "cap_ak_" },
  };

  it("returns anonymous for requests without credentials", async () => {
    const middleware = createAuthMiddleware(authConfig, {});
    const request = new Request("http://localhost/api/test");
    const ctx = await middleware(request);

    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.type).toBe("anonymous");
  });

  it("returns human auth for valid session cookies", async () => {
    const token = signSession(
      { userId: "user-1", email: "test@example.com", role: "admin" },
      TEST_SECRET,
    );
    const middleware = createAuthMiddleware(authConfig, {});
    const request = new Request("http://localhost/api/test", {
      headers: { cookie: `capstan_session=${token}` },
    });
    const ctx = await middleware(request);

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.type).toBe("human");
    expect(ctx.userId).toBe("user-1");
    expect(ctx.email).toBe("test@example.com");
    expect(ctx.role).toBe("admin");
  });

  it("returns anonymous for expired session cookies", async () => {
    const token = signSession({ userId: "user-1" }, TEST_SECRET, "0s");
    const middleware = createAuthMiddleware(authConfig, {});
    const request = new Request("http://localhost/api/test", {
      headers: { cookie: `capstan_session=${token}` },
    });
    const ctx = await middleware(request);

    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.type).toBe("anonymous");
  });

  it("returns agent auth for valid API keys", async () => {
    const { key, hash, prefix } = generateApiKey();

    const deps = {
      findAgentByKeyPrefix: async (lookupPrefix: string) => {
        if (lookupPrefix === prefix) {
          return {
            id: "agent-1",
            name: "Test Agent",
            apiKeyHash: hash,
            apiKeyPrefix: prefix,
            permissions: ["ticket:read", "ticket:write"],
          };
        }
        return null;
      },
    };

    const middleware = createAuthMiddleware(authConfig, deps);
    const request = new Request("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const ctx = await middleware(request);

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.type).toBe("agent");
    expect(ctx.agentId).toBe("agent-1");
    expect(ctx.agentName).toBe("Test Agent");
    expect(ctx.permissions).toEqual(["ticket:read", "ticket:write"]);
  });

  it("returns anonymous for invalid API keys", async () => {
    const { prefix } = generateApiKey();
    const badKey = "cap_ak_ffffffffffffffffffffffffffffffff";

    const deps = {
      findAgentByKeyPrefix: async (_lookupPrefix: string) => {
        return {
          id: "agent-1",
          name: "Agent",
          apiKeyHash: "wrong_hash_that_wont_match_anything_at_all_00000000000",
          apiKeyPrefix: prefix,
          permissions: [],
        };
      },
    };

    const middleware = createAuthMiddleware(authConfig, deps);
    const request = new Request("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${badKey}` },
    });
    const ctx = await middleware(request);

    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.type).toBe("anonymous");
  });

  it("returns anonymous when API key credential is revoked", async () => {
    const { key, hash, prefix } = generateApiKey();

    const deps = {
      findAgentByKeyPrefix: async (_lookupPrefix: string) => ({
        id: "agent-1",
        name: "Agent",
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        permissions: [],
        revokedAt: "2025-01-01T00:00:00Z",
      }),
    };

    const middleware = createAuthMiddleware(authConfig, deps);
    const request = new Request("http://localhost/api/test", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const ctx = await middleware(request);

    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.type).toBe("anonymous");
  });
});
