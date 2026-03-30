import { describe, it, expect, beforeEach } from "bun:test";
import { createHash } from "node:crypto";
import {
  validateDpopProof,
  clearDpopReplayCache,
} from "@zauso-ai/capstan-auth";

// ---------------------------------------------------------------------------
// Helpers — construct mock DPoP JWTs for testing parse/validation logic.
//
// Since crypto.subtle key generation + signing is needed for end-to-end
// signature verification, we split tests into two groups:
//   1. Structural/claim validation — use hand-crafted JWTs with a dummy sig.
//   2. Crypto verification — use real WebCrypto-generated keys.
// ---------------------------------------------------------------------------

function b64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return Buffer.from(json, "utf-8")
    .toString("base64url");
}

/** Build a compact JWT string from separate header, payload, and signature. */
function mockJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  sig = "invalid-signature-placeholder",
): string {
  return `${b64url(header)}.${b64url(payload)}.${Buffer.from(sig).toString("base64url")}`;
}

const DUMMY_RSA_JWK = {
  kty: "RSA",
  n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM",
  e: "AQAB",
};

const DUMMY_EC_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
};

function validHeader(jwk: Record<string, unknown> = DUMMY_RSA_JWK) {
  return { typ: "dpop+jwt", alg: "RS256", jwk };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    htm: "POST",
    htu: "https://api.example.com/resource",
    iat: Math.floor(Date.now() / 1000),
    jti: `jti-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateDpopProof", () => {
  beforeEach(() => {
    clearDpopReplayCache();
  });

  // ---- Happy path (crypto) -----------------------------------------------

  it("validates a real RS256-signed proof and returns a thumbprint", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const header = { typ: "dpop+jwt", alg: "RS256", jwk: pubJwk };
    const payload = validPayload();
    const headerB64 = b64url(header);
    const payloadB64 = b64url(payload);

    const sigBuf = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    const sigB64 = Buffer.from(sigBuf).toString("base64url");
    const proof = `${headerB64}.${payloadB64}.${sigB64}`;

    const result = await validateDpopProof(proof, "POST", "https://api.example.com/resource");
    expect(result).not.toBeNull();
    expect(typeof result!.thumbprint).toBe("string");
    expect(result!.thumbprint.length).toBeGreaterThan(0);
  });

  it("validates a real ES256-signed proof and returns a thumbprint", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const header = { typ: "dpop+jwt", alg: "ES256", jwk: pubJwk };
    const payload = validPayload({ htm: "GET", htu: "https://example.com/api" });
    const headerB64 = b64url(header);
    const payloadB64 = b64url(payload);

    const sigBuf = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    const sigB64 = Buffer.from(sigBuf).toString("base64url");
    const proof = `${headerB64}.${payloadB64}.${sigB64}`;

    const result = await validateDpopProof(proof, "GET", "https://example.com/api");
    expect(result).not.toBeNull();
    expect(typeof result!.thumbprint).toBe("string");
  });

  it("validates optional ath (access token hash) when present", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const accessToken = "my-secret-access-token";
    // Compute the expected ath: base64url(SHA-256(accessToken))
    const { createHash } = await import("node:crypto");
    const athHash = createHash("sha256").update(accessToken).digest();
    const ath = Buffer.from(athHash).toString("base64url");

    const header = { typ: "dpop+jwt", alg: "RS256", jwk: pubJwk };
    const payload = validPayload({ ath });
    const headerB64 = b64url(header);
    const payloadB64 = b64url(payload);

    const sigBuf = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    const sigB64 = Buffer.from(sigBuf).toString("base64url");
    const proof = `${headerB64}.${payloadB64}.${sigB64}`;

    const result = await validateDpopProof(proof, "POST", "https://api.example.com/resource", accessToken);
    expect(result).not.toBeNull();
  });

  // ---- Structural / parsing failures ------------------------------------

  it("returns null for malformed JWT (not 3 dot-separated parts)", async () => {
    expect(await validateDpopProof("only.two", "GET", "https://x.com/a")).toBeNull();
    expect(await validateDpopProof("a.b.c.d", "GET", "https://x.com/a")).toBeNull();
    expect(await validateDpopProof("nodots", "GET", "https://x.com/a")).toBeNull();
  });

  it("returns null for invalid base64url in header", async () => {
    const proof = `!!!invalid!!!.${b64url(validPayload())}.${Buffer.from("sig").toString("base64url")}`;
    expect(await validateDpopProof(proof, "POST", "https://api.example.com/resource")).toBeNull();
  });

  it("returns null for invalid base64url in payload", async () => {
    const proof = `${b64url(validHeader())}.!!!bad-b64!!!.${Buffer.from("sig").toString("base64url")}`;
    // Note: payload parsing happens after signature verification in the real
    // code, so this may fail at the crypto step first. Either way the result
    // is null — the proof is rejected.
    expect(await validateDpopProof(proof, "POST", "https://api.example.com/resource")).toBeNull();
  });

  it("returns null for invalid JSON in header", async () => {
    const notJson = Buffer.from("not-json{{{", "utf-8").toString("base64url");
    const proof = `${notJson}.${b64url(validPayload())}.${Buffer.from("sig").toString("base64url")}`;
    expect(await validateDpopProof(proof, "POST", "https://api.example.com/resource")).toBeNull();
  });

  it("returns null for invalid JSON in payload", async () => {
    const notJson = Buffer.from("{broken", "utf-8").toString("base64url");
    const proof = `${b64url(validHeader())}.${notJson}.${Buffer.from("sig").toString("base64url")}`;
    expect(await validateDpopProof(proof, "POST", "https://api.example.com/resource")).toBeNull();
  });

  it("returns null for missing typ: dpop+jwt in header", async () => {
    const header = { typ: "JWT", alg: "RS256", jwk: DUMMY_RSA_JWK };
    const proof = mockJwt(header, validPayload());
    expect(await validateDpopProof(proof, "POST", "https://api.example.com/resource")).toBeNull();
  });

  it("returns null for unsupported algorithm", async () => {
    const header = { typ: "dpop+jwt", alg: "HS256", jwk: DUMMY_RSA_JWK };
    const proof = mockJwt(header, validPayload());
    expect(await validateDpopProof(proof, "POST", "https://api.example.com/resource")).toBeNull();
  });

  it("returns null for missing JWK in header", async () => {
    const header = { typ: "dpop+jwt", alg: "RS256" };
    const proof = mockJwt(header, validPayload());
    expect(await validateDpopProof(proof, "POST", "https://api.example.com/resource")).toBeNull();
  });

  it("returns null for JWK containing private key (d field)", async () => {
    const jwkWithPrivate = { ...DUMMY_RSA_JWK, d: "secret-private-exponent" };
    const header = { typ: "dpop+jwt", alg: "RS256", jwk: jwkWithPrivate };
    const proof = mockJwt(header, validPayload());
    expect(await validateDpopProof(proof, "POST", "https://api.example.com/resource")).toBeNull();
  });

  // ---- Claim validation (using real crypto to get past sig check) --------

  /**
   * Helper: generate a real signed DPoP proof with custom payload overrides.
   */
  async function signedProof(
    payloadOverrides: Record<string, unknown> = {},
    alg: "RS256" | "ES256" = "RS256",
  ): Promise<{ proof: string; method: string; url: string }> {
    const method = (payloadOverrides.htm as string) ?? "POST";
    const url = (payloadOverrides.htu as string) ?? "https://api.example.com/resource";

    let keyPair: CryptoKeyPair;
    let signAlg: AlgorithmIdentifier | EcdsaParams;

    if (alg === "RS256") {
      keyPair = await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign", "verify"],
      );
      signAlg = "RSASSA-PKCS1-v1_5";
    } else {
      keyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
      );
      signAlg = { name: "ECDSA", hash: "SHA-256" };
    }

    const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const header = { typ: "dpop+jwt", alg, jwk: pubJwk };
    const payload = validPayload(payloadOverrides);
    const headerB64 = b64url(header);
    const payloadB64 = b64url(payload);

    const sigBuf = await crypto.subtle.sign(
      signAlg,
      keyPair.privateKey,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    const sigB64 = Buffer.from(sigBuf).toString("base64url");

    return { proof: `${headerB64}.${payloadB64}.${sigB64}`, method, url };
  }

  it("returns null when htm (method) does not match", async () => {
    const { proof } = await signedProof({ htm: "POST" });
    const result = await validateDpopProof(proof, "DELETE", "https://api.example.com/resource");
    expect(result).toBeNull();
  });

  it("returns null when htu (URL) does not match", async () => {
    const { proof } = await signedProof({ htu: "https://api.example.com/resource" });
    const result = await validateDpopProof(proof, "POST", "https://api.example.com/other");
    expect(result).toBeNull();
  });

  it("returns null for expired proof (iat too old)", async () => {
    const tooOld = Math.floor(Date.now() / 1000) - 400; // 400s ago, beyond 300s max
    const { proof, method, url } = await signedProof({ iat: tooOld });
    const result = await validateDpopProof(proof, method, url);
    expect(result).toBeNull();
  });

  it("returns null for future proof (iat beyond clock skew)", async () => {
    const tooFuture = Math.floor(Date.now() / 1000) + 120; // 120s in future, beyond 60s skew
    const { proof, method, url } = await signedProof({ iat: tooFuture });
    const result = await validateDpopProof(proof, method, url);
    expect(result).toBeNull();
  });

  it("returns null for missing jti claim", async () => {
    // Generate a signed proof, then rebuild without jti by removing it
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const header = { typ: "dpop+jwt", alg: "RS256", jwk: pubJwk };
    const payload = {
      htm: "POST",
      htu: "https://api.example.com/resource",
      iat: Math.floor(Date.now() / 1000),
      // jti intentionally omitted
    };
    const headerB64 = b64url(header);
    const payloadB64 = b64url(payload);

    const sigBuf = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    const sigB64 = Buffer.from(sigBuf).toString("base64url");
    const proof = `${headerB64}.${payloadB64}.${sigB64}`;

    const result = await validateDpopProof(proof, "POST", "https://api.example.com/resource");
    expect(result).toBeNull();
  });

  it("returns null for replayed jti (same jti used twice)", async () => {
    const fixedJti = "unique-jti-for-replay-test";
    const { proof: proof1, method, url } = await signedProof({ jti: fixedJti });

    // First use should succeed
    const result1 = await validateDpopProof(proof1, method, url);
    expect(result1).not.toBeNull();

    // Second use with the same jti from a fresh signed proof
    const { proof: proof2 } = await signedProof({ jti: fixedJti });
    const result2 = await validateDpopProof(proof2, method, url);
    expect(result2).toBeNull();
  });

  it("returns null for an invalid signature", async () => {
    // Generate a valid proof, then swap the signature with garbage
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const header = { typ: "dpop+jwt", alg: "RS256", jwk: pubJwk };
    const payload = validPayload();
    const headerB64 = b64url(header);
    const payloadB64 = b64url(payload);

    // Use a completely wrong signature
    const badSig = Buffer.from("this-is-not-a-valid-rsa-signature-at-all").toString("base64url");
    const proof = `${headerB64}.${payloadB64}.${badSig}`;

    const result = await validateDpopProof(proof, "POST", "https://api.example.com/resource");
    expect(result).toBeNull();
  });

  // ---- Boundary conditions -----------------------------------------------

  it("accepts iat exactly at MAX_CLOCK_SKEW boundary (60s future)", async () => {
    const atBoundary = Math.floor(Date.now() / 1000) + 60;
    const { proof, method, url } = await signedProof({ iat: atBoundary });
    const result = await validateDpopProof(proof, method, url);
    expect(result).not.toBeNull();
  });

  it("rejects iat beyond MAX_CLOCK_SKEW (64s future)", async () => {
    const beyondBoundary = Math.floor(Date.now() / 1000) + 64;
    const { proof, method, url } = await signedProof({ iat: beyondBoundary });
    const result = await validateDpopProof(proof, method, url);
    expect(result).toBeNull();
  });

  it("accepts htu matching when request URL has query string", async () => {
    // DPoP spec: htu is scheme+authority+path, query/fragment are ignored
    const { proof } = await signedProof({ htu: "https://api.example.com/resource" });
    const result = await validateDpopProof(proof, "POST", "https://api.example.com/resource?foo=bar");
    expect(result).not.toBeNull();
  });

  it("rejects htu when port differs", async () => {
    const { proof } = await signedProof({ htu: "https://api.example.com:8443/resource" });
    const result = await validateDpopProof(proof, "POST", "https://api.example.com:9443/resource");
    expect(result).toBeNull();
  });

  it("returns null for empty string proof", async () => {
    expect(await validateDpopProof("", "GET", "https://x.com/a")).toBeNull();
  });

  it("returns null for a very long malformed JWT string", async () => {
    const longString = "a".repeat(100_000) + "." + "b".repeat(100_000) + "." + "c".repeat(100_000);
    expect(await validateDpopProof(longString, "GET", "https://x.com/a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clearDpopReplayCache
// ---------------------------------------------------------------------------

describe("clearDpopReplayCache", () => {
  it("allows a previously-seen jti to be reused after clearing", async () => {
    const fixedJti = "clear-cache-test-jti";

    // Generate two separate key pairs to get two separately-signed proofs with
    // the same jti (the second would normally be rejected as a replay).
    const keyPairA = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const pubJwkA = await crypto.subtle.exportKey("jwk", keyPairA.publicKey);

    const buildProof = async (kp: CryptoKeyPair, pubJwk: JsonWebKey) => {
      const header = { typ: "dpop+jwt", alg: "RS256", jwk: pubJwk };
      const payload = validPayload({ jti: fixedJti });
      const hB64 = b64url(header);
      const pB64 = b64url(payload);
      const sig = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        kp.privateKey,
        new TextEncoder().encode(`${hB64}.${pB64}`),
      );
      return `${hB64}.${pB64}.${Buffer.from(sig).toString("base64url")}`;
    };

    const proof1 = await buildProof(keyPairA, pubJwkA);
    const result1 = await validateDpopProof(proof1, "POST", "https://api.example.com/resource");
    expect(result1).not.toBeNull();

    // Clear the replay cache
    clearDpopReplayCache();

    // Same jti should now succeed again with a fresh proof
    const keyPairB = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const pubJwkB = await crypto.subtle.exportKey("jwk", keyPairB.publicKey);
    const proof2 = await buildProof(keyPairB, pubJwkB);
    const result2 = await validateDpopProof(proof2, "POST", "https://api.example.com/resource");
    expect(result2).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Security edge cases — crypto-based tests with independent helpers
// ---------------------------------------------------------------------------

function base64urlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlEncodeString(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}

/** Generate an EC P-256 key pair for signing DPoP proofs. */
async function generateKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { privateKey: keyPair.privateKey, publicJwk };
}

/** Build and sign a DPoP proof JWT. */
async function buildDpopProof(opts: {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  method: string;
  url: string;
  jti?: string;
  iat?: number;
  ath?: string;
}): Promise<string> {
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: opts.publicJwk,
  };
  const payload: Record<string, unknown> = {
    htm: opts.method,
    htu: opts.url,
    iat: opts.iat ?? Math.floor(Date.now() / 1000),
    jti: opts.jti ?? crypto.randomUUID(),
  };
  if (opts.ath !== undefined) {
    payload.ath = opts.ath;
  }

  const headerB64 = base64urlEncodeString(JSON.stringify(header));
  const payloadB64 = base64urlEncodeString(JSON.stringify(payload));
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    opts.privateKey,
    signingInput,
  );

  return `${headerB64}.${payloadB64}.${base64urlEncode(signature)}`;
}

/** Compute the access-token hash (ath) used in DPoP proofs. */
function computeAth(accessToken: string): string {
  return base64urlEncode(
    createHash("sha256").update(accessToken).digest(),
  );
}

/**
 * Compute the JWK thumbprint (RFC 7638) for an EC key independently from
 * the source code, so we can verify the returned thumbprint.
 */
function computeExpectedThumbprint(jwk: JsonWebKey): string {
  // For EC keys: required members are crv, kty, x, y in lexicographic order.
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const hash = createHash("sha256").update(canonical).digest();
  return base64urlEncode(hash);
}

const DPOP_TEST_METHOD = "POST";
const DPOP_TEST_URL = "https://example.com/api/resource";

describe("validateDpopProof — security edge cases", () => {
  beforeEach(() => {
    clearDpopReplayCache();
  });

  // ── 1. ath mismatch rejection ──────────────────────────────────────────
  it("rejects a proof whose ath does not match the provided accessToken", async () => {
    const { privateKey, publicJwk } = await generateKeyPair();
    const realToken = "real-access-token-abc";
    const wrongAth = computeAth("different-access-token-xyz");

    const proof = await buildDpopProof({
      privateKey,
      publicJwk,
      method: DPOP_TEST_METHOD,
      url: DPOP_TEST_URL,
      ath: wrongAth,
    });

    const result = await validateDpopProof(proof, DPOP_TEST_METHOD, DPOP_TEST_URL, realToken);
    expect(result).toBeNull();
  });

  it("accepts a proof whose ath correctly matches the provided accessToken", async () => {
    const { privateKey, publicJwk } = await generateKeyPair();
    const accessToken = "my-access-token-123";
    const correctAth = computeAth(accessToken);

    const proof = await buildDpopProof({
      privateKey,
      publicJwk,
      method: DPOP_TEST_METHOD,
      url: DPOP_TEST_URL,
      ath: correctAth,
    });

    const result = await validateDpopProof(proof, DPOP_TEST_METHOD, DPOP_TEST_URL, accessToken);
    expect(result).not.toBeNull();
    expect(result!.thumbprint.length).toBeGreaterThan(0);
  });

  // ── 2. Empty jti string ────────────────────────────────────────────────
  it("rejects a proof with an empty jti string", async () => {
    const { privateKey, publicJwk } = await generateKeyPair();

    const proof = await buildDpopProof({
      privateKey,
      publicJwk,
      method: DPOP_TEST_METHOD,
      url: DPOP_TEST_URL,
      jti: "",
    });

    const result = await validateDpopProof(proof, DPOP_TEST_METHOD, DPOP_TEST_URL);
    expect(result).toBeNull();
  });

  // ── 3. iat boundary at MAX_PROOF_AGE (300s) ────────────────────────────
  it("accepts a proof with iat exactly at MAX_PROOF_AGE (300s ago)", async () => {
    const { privateKey, publicJwk } = await generateKeyPair();
    const nowSeconds = Math.floor(Date.now() / 1000);

    // iat = now - 300 => nowSeconds - iat = 300, which is NOT > 300, so it passes.
    const proof = await buildDpopProof({
      privateKey,
      publicJwk,
      method: DPOP_TEST_METHOD,
      url: DPOP_TEST_URL,
      iat: nowSeconds - 300,
    });

    const result = await validateDpopProof(proof, DPOP_TEST_METHOD, DPOP_TEST_URL);
    expect(result).not.toBeNull();
  });

  it("rejects a proof with iat at 301s ago (one second past MAX_PROOF_AGE)", async () => {
    const { privateKey, publicJwk } = await generateKeyPair();
    const nowSeconds = Math.floor(Date.now() / 1000);

    // iat = now - 301 => nowSeconds - iat = 301 > 300, so it fails.
    const proof = await buildDpopProof({
      privateKey,
      publicJwk,
      method: DPOP_TEST_METHOD,
      url: DPOP_TEST_URL,
      iat: nowSeconds - 301,
    });

    const result = await validateDpopProof(proof, DPOP_TEST_METHOD, DPOP_TEST_URL);
    expect(result).toBeNull();
  });

  // ── 4. Verify thumbprint correctness ───────────────────────────────────
  it("returns a thumbprint that is the base64url SHA-256 of the canonical JWK", async () => {
    const { privateKey, publicJwk } = await generateKeyPair();

    const proof = await buildDpopProof({
      privateKey,
      publicJwk,
      method: DPOP_TEST_METHOD,
      url: DPOP_TEST_URL,
    });

    const result = await validateDpopProof(proof, DPOP_TEST_METHOD, DPOP_TEST_URL);
    expect(result).not.toBeNull();

    // Independently compute the expected thumbprint.
    const expected = computeExpectedThumbprint(publicJwk);
    expect(result!.thumbprint).toBe(expected);

    // Verify it looks like a base64url-encoded SHA-256 hash (43 chars, no padding).
    expect(result!.thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  // ── 5. ath present but no accessToken parameter ────────────────────────
  it("accepts a proof with an ath claim when accessToken parameter is omitted", async () => {
    const { privateKey, publicJwk } = await generateKeyPair();

    // Proof includes an ath, but we call without an accessToken.
    // Source: if (accessToken !== undefined) { ... } — so ath check is skipped.
    const proof = await buildDpopProof({
      privateKey,
      publicJwk,
      method: DPOP_TEST_METHOD,
      url: DPOP_TEST_URL,
      ath: computeAth("some-token"),
    });

    const result = await validateDpopProof(proof, DPOP_TEST_METHOD, DPOP_TEST_URL);
    expect(result).not.toBeNull();
    expect(result!.thumbprint.length).toBeGreaterThan(0);
  });
});
