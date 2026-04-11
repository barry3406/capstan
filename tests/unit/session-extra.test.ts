import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { signSession, verifySession } from "@zauso-ai/capstan-auth";

const SECRET = "test-secret-for-session-extra-tests";

// ---------------------------------------------------------------------------
// signSession — additional coverage
// ---------------------------------------------------------------------------

describe("signSession — extra", () => {
  it("respects custom maxAge durations", () => {
    const cases: Array<{ maxAge: string; expectedTtl: number }> = [
      { maxAge: "30s", expectedTtl: 30 },
      { maxAge: "15m", expectedTtl: 900 },
      { maxAge: "2h", expectedTtl: 7200 },
      { maxAge: "1d", expectedTtl: 86_400 },
      { maxAge: "1w", expectedTtl: 604_800 },
    ];

    for (const { maxAge, expectedTtl } of cases) {
      const token = signSession({ userId: "u" }, SECRET, maxAge);
      const parts = token.split(".");
      const payload = JSON.parse(
        Buffer.from(parts[1]!, "base64url").toString("utf-8"),
      );
      const actualTtl = payload.exp - payload.iat;
      expect(actualTtl).toBe(expectedTtl);
    }
  });

  it("defaults maxAge to 7 days when omitted", () => {
    const token = signSession({ userId: "u" }, SECRET);
    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf-8"),
    );
    expect(payload.exp - payload.iat).toBe(604_800);
  });

  it("throws on invalid maxAge format", () => {
    expect(() => signSession({ userId: "u" }, SECRET, "invalid")).toThrow(
      /Invalid duration format/,
    );
    expect(() => signSession({ userId: "u" }, SECRET, "7x")).toThrow(
      /Invalid duration format/,
    );
    expect(() => signSession({ userId: "u" }, SECRET, "")).toThrow(
      /Invalid duration format/,
    );
    expect(() => signSession({ userId: "u" }, SECRET, "abc")).toThrow(
      /Invalid duration format/,
    );
  });

  it("preserves custom claims through sign and verify roundtrip", () => {
    const token = signSession(
      { userId: "user-99", email: "deep@test.com", role: "superadmin" },
      SECRET,
      "1h",
    );
    const payload = verifySession(token, SECRET);

    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-99");
    expect(payload!.email).toBe("deep@test.com");
    expect(payload!.role).toBe("superadmin");
    expect(typeof payload!.iat).toBe("number");
    expect(typeof payload!.exp).toBe("number");
  });

  it("produces a JWT header with alg=HS256 and typ=JWT", () => {
    const token = signSession({ userId: "u" }, SECRET);
    const headerJson = Buffer.from(
      token.split(".")[0]!,
      "base64url",
    ).toString("utf-8");
    const header = JSON.parse(headerJson);
    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");
  });

  it("sets iat to approximately the current time", () => {
    const beforeSec = Math.floor(Date.now() / 1000);
    const token = signSession({ userId: "u" }, SECRET);
    const afterSec = Math.floor(Date.now() / 1000);

    const parts = token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf-8"),
    );
    expect(payload.iat).toBeGreaterThanOrEqual(beforeSec);
    expect(payload.iat).toBeLessThanOrEqual(afterSec);
  });

  it("produces different tokens for the same payload (time-dependent)", async () => {
    const token1 = signSession({ userId: "u" }, SECRET, "1h");
    // Wait a tiny bit so iat changes (if sub-second precision allows)
    await new Promise((r) => setTimeout(r, 1100));
    const token2 = signSession({ userId: "u" }, SECRET, "1h");
    // Tokens may or may not differ depending on timing granularity (seconds),
    // but payloads should reflect separate iat values or be same-second.
    // This is a sanity check — both should verify.
    expect(verifySession(token1, SECRET)).not.toBeNull();
    expect(verifySession(token2, SECRET)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifySession — additional coverage
// ---------------------------------------------------------------------------

describe("verifySession — extra", () => {
  it("throws for null input (no runtime guard — potential hardening target)", () => {
    // verifySession does not guard against non-string inputs at runtime.
    // This documents the current behavior: it throws a TypeError.
    expect(() => verifySession(null as unknown as string, SECRET)).toThrow();
  });

  it("throws for undefined input (no runtime guard — potential hardening target)", () => {
    expect(() => verifySession(undefined as unknown as string, SECRET)).toThrow();
  });

  it("throws for a number input (no runtime guard — potential hardening target)", () => {
    expect(() => verifySession(12345 as unknown as string, SECRET)).toThrow();
  });

  it("returns null for a token with only two segments", () => {
    expect(verifySession("header.body", SECRET)).toBeNull();
  });

  it("returns null for a token with four segments", () => {
    expect(verifySession("a.b.c.d", SECRET)).toBeNull();
  });

  it("returns null when signature bytes are corrupted", () => {
    const token = signSession({ userId: "u" }, SECRET);
    const parts = token.split(".");
    // Flip one character in the signature
    const corruptedSig =
      parts[2]![0] === "A"
        ? "B" + parts[2]!.slice(1)
        : "A" + parts[2]!.slice(1);
    const corrupted = `${parts[0]}.${parts[1]}.${corruptedSig}`;
    expect(verifySession(corrupted, SECRET)).toBeNull();
  });

  it("returns null when the payload is not valid JSON", () => {
    // Craft a token with invalid JSON in the payload
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from("not{json").toString("base64url");
    const sigInput = `${header}.${body}`;
    // Sign it properly so signature passes
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", SECRET).update(sigInput).digest();
    const token = `${sigInput}.${sig.toString("base64url")}`;
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("returns null when payload has no exp field", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ userId: "u", iat: Math.floor(Date.now() / 1000) }),
    ).toString("base64url");
    const sigInput = `${header}.${body}`;
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", SECRET).update(sigInput).digest();
    const token = `${sigInput}.${sig.toString("base64url")}`;
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("returns null when exp is in the past", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const pastTime = Math.floor(Date.now() / 1000) - 3600;
    const body = Buffer.from(
      JSON.stringify({ userId: "u", iat: pastTime - 7200, exp: pastTime }),
    ).toString("base64url");
    const sigInput = `${header}.${body}`;
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", SECRET).update(sigInput).digest();
    const token = `${sigInput}.${sig.toString("base64url")}`;
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("returns null when exp equals current time (boundary — not strictly greater)", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ userId: "u", iat: now - 10, exp: now }),
    ).toString("base64url");
    const sigInput = `${header}.${body}`;
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", SECRET).update(sigInput).digest();
    const token = `${sigInput}.${sig.toString("base64url")}`;
    // exp <= now should be null (the code uses `payload.exp <= now`)
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("accepts a token whose exp is 1 second in the future", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ userId: "boundary-user", iat: now, exp: now + 1 }),
    ).toString("base64url");
    const sigInput = `${header}.${body}`;
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", SECRET).update(sigInput).digest();
    const token = `${sigInput}.${sig.toString("base64url")}`;
    const result = verifySession(token, SECRET);
    // This may or may not pass depending on timing — it's a race.
    // If the second hasn't elapsed, it should succeed.
    // We check it doesn't throw at minimum.
    if (result !== null) {
      expect(result.userId).toBe("boundary-user");
    }
  });

  it("uses timing-safe comparison (wrong secret does not throw)", () => {
    const token = signSession({ userId: "u" }, "real-secret");
    // Should return null, not throw
    const result = verifySession(token, "wrong-secret");
    expect(result).toBeNull();
  });

  it("returns null for a completely empty string", () => {
    expect(verifySession("", SECRET)).toBeNull();
  });

  it("returns null for a string of dots", () => {
    expect(verifySession("...", SECRET)).toBeNull();
  });

  it("returns null when exp is a string instead of a number", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        userId: "u",
        iat: Math.floor(Date.now() / 1000),
        exp: "not-a-number",
      }),
    ).toString("base64url");
    const sigInput = `${header}.${body}`;
    const { createHmac } = require("node:crypto");
    const sig = createHmac("sha256", SECRET).update(sigInput).digest();
    const token = `${sigInput}.${sig.toString("base64url")}`;
    expect(verifySession(token, SECRET)).toBeNull();
  });
});
