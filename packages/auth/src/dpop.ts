import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// DPoP Proof Validation (RFC 9449)
// ---------------------------------------------------------------------------

/**
 * Result of a successful DPoP proof validation.
 */
export interface DpopValidationResult {
  /** Base64url-encoded JWK thumbprint (RFC 7638) of the proof key. */
  thumbprint: string;
}

/** Maximum age (in seconds) for a DPoP proof's `iat` claim. */
const MAX_PROOF_AGE_SECONDS = 300; // 5 minutes

/** Minimum age (in seconds) — reject proofs from the far future. */
const MAX_CLOCK_SKEW_SECONDS = 60;

/**
 * Track recently seen `jti` values to prevent replay.
 *
 * Map of jti -> expiry timestamp (ms).  Entries are lazily pruned.
 */
const seenJtis = new Map<string, number>();

/** Periodic cleanup for the JTI replay cache. */
let jtiCleanupTimer: ReturnType<typeof setInterval> | undefined;

function ensureJtiCleanup(): void {
  if (jtiCleanupTimer !== undefined) return;
  jtiCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [jti, expiresAt] of seenJtis) {
      if (expiresAt <= now) {
        seenJtis.delete(jti);
      }
    }
  }, 60_000);
  if (typeof jtiCleanupTimer === "object" && "unref" in jtiCleanupTimer) {
    jtiCleanupTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function base64urlDecode(str: string): Uint8Array {
  // Convert base64url to standard base64.
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Pad with '=' to make length a multiple of 4.
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function base64urlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// JWK Thumbprint (RFC 7638)
// ---------------------------------------------------------------------------

/**
 * Compute the JWK thumbprint per RFC 7638.
 *
 * For RSA keys the required members are: e, kty, n
 * For EC keys: crv, kty, x, y
 */
function computeJwkThumbprint(jwk: JsonWebKey): string {
  let canonicalMembers: Record<string, string | undefined>;

  if (jwk.kty === "RSA") {
    canonicalMembers = { e: jwk.e, kty: jwk.kty, n: jwk.n };
  } else if (jwk.kty === "EC") {
    canonicalMembers = {
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
      y: jwk.y,
    };
  } else {
    throw new Error(`Unsupported key type: ${jwk.kty}`);
  }

  // Lexicographic ordering of keys (JSON Canonicalization is just sorted keys
  // for the required members).
  const sortedKeys = Object.keys(canonicalMembers).sort();
  const json =
    "{" +
    sortedKeys
      .map((k) => `${JSON.stringify(k)}:${JSON.stringify(canonicalMembers[k])}`)
      .join(",") +
    "}";

  const hash = createHash("sha256").update(json).digest();
  return base64urlEncode(hash);
}

// ---------------------------------------------------------------------------
// Algorithm mapping
// ---------------------------------------------------------------------------

interface AlgorithmMapping {
  name: string;
  hash?: string;
  namedCurve?: string;
}

function mapAlgorithm(alg: string): AlgorithmMapping | null {
  switch (alg) {
    case "RS256":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    case "RS384":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" };
    case "RS512":
      return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" };
    case "ES256":
      return { name: "ECDSA", hash: "SHA-256", namedCurve: "P-256" };
    case "ES384":
      return { name: "ECDSA", hash: "SHA-384", namedCurve: "P-384" };
    case "ES512":
      return { name: "ECDSA", hash: "SHA-512", namedCurve: "P-521" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a DPoP proof JWT per RFC 9449.
 *
 * The proof is a compact-serialized JWT whose header contains the public key
 * (`jwk`) used to sign the proof.  The function:
 *
 * 1. Parses the JOSE header and verifies `typ: "dpop+jwt"` and a supported `alg`.
 * 2. Extracts the embedded `jwk` and imports it via Web Crypto.
 * 3. Verifies the JWT signature using the imported key.
 * 4. Validates required claims:
 *    - `htm` — must match the provided HTTP method.
 *    - `htu` — must match the provided HTTP URI (scheme + authority + path).
 *    - `iat` — must be within the acceptable time window.
 *    - `jti` — must be unique (checked against an in-memory replay cache).
 * 5. If an `accessToken` is provided, verifies the `ath` (access token hash)
 *    claim matches the SHA-256 hash of the token.
 *
 * Returns the JWK thumbprint on success, or `null` if validation fails.
 *
 * @param proof   - The DPoP proof from the `DPoP` request header.
 * @param method  - The HTTP method of the request (e.g. "POST").
 * @param url     - The full request URL.
 * @param accessToken - Optional access token to verify `ath` binding.
 */
export async function validateDpopProof(
  proof: string,
  method: string,
  url: string,
  accessToken?: string,
): Promise<DpopValidationResult | null> {
  ensureJtiCleanup();

  // ── 1. Split compact serialization ──────────────────────────────
  const parts = proof.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];

  // ── 2. Parse header ─────────────────────────────────────────────
  let header: {
    typ?: string;
    alg?: string;
    jwk?: JsonWebKey;
  };
  try {
    header = JSON.parse(
      new TextDecoder().decode(base64urlDecode(headerB64)),
    );
  } catch {
    return null;
  }

  // Must be typ: dpop+jwt
  if (header.typ !== "dpop+jwt") return null;

  // Must have a supported algorithm
  if (!header.alg) return null;
  const algMapping = mapAlgorithm(header.alg);
  if (!algMapping) return null;

  // Must have an embedded JWK
  if (!header.jwk || typeof header.jwk !== "object") return null;

  // The JWK must not contain a private key
  if ("d" in header.jwk) return null;

  // ── 3. Import the public key and verify signature ───────────────
  let importAlg: RsaHashedImportParams | EcKeyImportParams;
  if (algMapping.name === "RSASSA-PKCS1-v1_5") {
    importAlg = { name: algMapping.name, hash: algMapping.hash! };
  } else {
    importAlg = {
      name: algMapping.name,
      namedCurve: algMapping.namedCurve!,
    };
  }

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      header.jwk,
      importAlg,
      false,
      ["verify"],
    );
  } catch {
    return null;
  }

  // Verify the signature over header.payload
  const signingInput = new TextEncoder().encode(
    `${headerB64}.${payloadB64}`,
  );
  const signature = base64urlDecode(signatureB64);

  let verifyAlg: AlgorithmIdentifier | EcdsaParams;
  if (algMapping.name === "ECDSA") {
    verifyAlg = { name: "ECDSA", hash: algMapping.hash! };
  } else {
    verifyAlg = { name: algMapping.name };
  }

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      verifyAlg,
      publicKey,
      signature.buffer as ArrayBuffer,
      signingInput,
    );
  } catch {
    return null;
  }

  if (!valid) return null;

  // ── 4. Parse and validate payload claims ────────────────────────
  let payload: {
    htm?: string;
    htu?: string;
    iat?: number;
    jti?: string;
    ath?: string;
  };
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64)),
    );
  } catch {
    return null;
  }

  // htm — HTTP method must match
  if (typeof payload.htm !== "string") return null;
  if (payload.htm.toUpperCase() !== method.toUpperCase()) return null;

  // htu — HTTP URI must match (scheme + authority + path, no query/fragment)
  if (typeof payload.htu !== "string") return null;
  try {
    const proofUrl = new URL(payload.htu);
    const requestUrl = new URL(url);
    // Compare origin + pathname (ignoring query string and fragment).
    if (
      proofUrl.origin !== requestUrl.origin ||
      proofUrl.pathname !== requestUrl.pathname
    ) {
      return null;
    }
  } catch {
    return null;
  }

  // iat — issued at must be recent
  if (typeof payload.iat !== "number") return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) return null;
  if (nowSeconds - payload.iat > MAX_PROOF_AGE_SECONDS) return null;

  // jti — unique identifier, prevent replay
  if (typeof payload.jti !== "string" || payload.jti.length === 0) return null;
  if (seenJtis.has(payload.jti)) return null;

  // Record the jti with an expiry matching the proof window.
  seenJtis.set(
    payload.jti,
    Date.now() + (MAX_PROOF_AGE_SECONDS + MAX_CLOCK_SKEW_SECONDS) * 1000,
  );

  // ── 5. Access token hash binding (ath) ──────────────────────────
  if (accessToken !== undefined) {
    const expectedAth = base64urlEncode(
      createHash("sha256").update(accessToken).digest(),
    );
    if (payload.ath !== expectedAth) return null;
  }

  // ── 6. Compute JWK thumbprint ───────────────────────────────────
  let thumbprint: string;
  try {
    thumbprint = computeJwkThumbprint(header.jwk);
  } catch {
    return null;
  }

  return { thumbprint };
}

/**
 * Clear the DPoP JTI replay cache.
 *
 * Useful for tests so state does not leak between test cases.
 */
export function clearDpopReplayCache(): void {
  seenJtis.clear();
}
