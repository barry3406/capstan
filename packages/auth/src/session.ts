import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  SessionPayload,
  SessionSigningOptions,
  SessionVerificationOptions,
} from "./types.js";

// ── Base64url helpers ──────────────────────────────────────────────

function base64urlEncode(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64url");
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf-8");
}

// ── Duration parsing ───────────────────────────────────────────────

/**
 * Parse a human-friendly duration string into seconds.
 *
 * Supported suffixes:
 *   "s" — seconds   "m" — minutes   "h" — hours   "d" — days   "w" — weeks
 *
 * Examples: "7d" → 604800, "1h" → 3600, "30m" → 1800
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*(s|m|h|d|w)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${duration}". Expected a number followed by s, m, h, d, or w.`,
    );
  }

  const value = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d" | "w";

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86_400,
    w: 604_800,
  };

  return value * multipliers[unit]!;
}

// ── JWT implementation (HS256) ─────────────────────────────────────

function sign(payload: string, secret: string): string {
  const header = base64urlEncode(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const body = base64urlEncode(payload);
  const signingInput = `${header}.${body}`;

  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64urlEncode(signature)}`;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Create a signed JWT containing the given session data.
 *
 * `maxAge` defaults to `"7d"` (7 days) when omitted.
 */
export function signSession(
  payload: Omit<SessionPayload, "iat" | "exp">,
  secret: string,
  maxAgeOrOptions?: string | SessionSigningOptions,
): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const options =
    typeof maxAgeOrOptions === "string"
      ? { maxAge: maxAgeOrOptions }
      : (maxAgeOrOptions ?? {});
  const ttl = parseDuration(options.maxAge ?? "7d");

  const full: SessionPayload = {
    ...payload,
    ...(options.issuer !== undefined ? { iss: options.issuer } : {}),
    ...(options.audience !== undefined ? { aud: options.audience } : {}),
    iat: nowSeconds,
    exp: nowSeconds + ttl,
  };

  return sign(JSON.stringify(full), secret);
}

/**
 * Verify a JWT's HMAC-SHA256 signature and expiration.
 *
 * Returns the decoded payload on success, or `null` when the token is
 * invalid, tampered with, or expired.
 */
export function verifySession(
  token: string,
  secret: string,
  options?: SessionVerificationOptions,
): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts as [string, string, string];

  // Recompute the expected signature.
  const expectedSig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest();

  const actualSig = Buffer.from(sig, "base64url");

  // Timing-safe comparison to prevent timing attacks.
  if (expectedSig.length !== actualSig.length) return null;
  if (!timingSafeEqual(expectedSig, actualSig)) return null;

  // Decode payload.
  try {
    const payload: SessionPayload = JSON.parse(base64urlDecode(body));

    // Check expiration.
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (options?.issuer !== undefined && payload.iss !== options.issuer) {
      return null;
    }
    if (options?.audience !== undefined) {
      const audiences = Array.isArray(payload.aud)
        ? payload.aud
        : payload.aud !== undefined
          ? [payload.aud]
          : [];
      if (!audiences.includes(options.audience)) {
        return null;
      }
    }

    return payload;
  } catch {
    return null;
  }
}
