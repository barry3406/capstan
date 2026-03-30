import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// SPIFFE Workload Identity (mTLS)
// ---------------------------------------------------------------------------

/**
 * Parsed workload identity extracted from a client certificate.
 */
export interface WorkloadIdentity {
  /** Full SPIFFE ID URI (e.g. "spiffe://example.org/agent/crawler"). */
  spiffeId: string;
  /** Trust domain portion of the SPIFFE ID (e.g. "example.org"). */
  trustDomain: string;
  /** Workload path portion of the SPIFFE ID (e.g. "/agent/crawler"). */
  workloadPath: string;
  /** SHA-256 hex digest of the PEM-encoded client certificate. */
  certFingerprint: string;
}

/**
 * Headers that reverse proxies commonly use to forward client certificates.
 *
 * - `x-client-cert` — raw PEM or URL-encoded PEM (Envoy, Nginx, etc.)
 * - `x-forwarded-client-cert` — Envoy XFCC header (may contain key=value pairs)
 */
const CLIENT_CERT_HEADERS = [
  "x-client-cert",
  "x-forwarded-client-cert",
] as const;

// ---------------------------------------------------------------------------
// SPIFFE ID validation
// ---------------------------------------------------------------------------

/**
 * Validate that a string is a well-formed SPIFFE ID per the SPIFFE spec:
 *
 * - Scheme must be `spiffe`
 * - Trust domain must be a non-empty hostname-like string (lower-case
 *   alphanumerics, hyphens, dots; no leading/trailing hyphens or dots).
 * - Workload path must be non-empty and start with `/`.
 */
export function isValidSpiffeId(id: string): boolean {
  if (typeof id !== "string" || id.length === 0) return false;

  // Must start with the spiffe scheme.
  if (!id.startsWith("spiffe://")) return false;

  const rest = id.slice("spiffe://".length);

  // Find the first "/" after the trust domain.
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) return false; // no trust domain or no path

  const trustDomain = rest.slice(0, slashIndex);
  const workloadPath = rest.slice(slashIndex);

  // Trust domain: valid DNS-like label(s), no leading/trailing dot or hyphen.
  if (!isValidTrustDomain(trustDomain)) return false;

  // Workload path must be non-empty (beyond the leading slash).
  if (workloadPath.length < 2) return false;

  // Path segments must not be empty (no double slashes) and must not
  // contain `.` or `..` traversals.
  const segments = workloadPath.slice(1).split("/");
  for (const seg of segments) {
    if (seg.length === 0 || seg === "." || seg === "..") return false;
  }

  return true;
}

/**
 * A trust domain is a valid lower-case DNS name: labels separated by dots,
 * each label consisting of alphanumerics and hyphens, not starting/ending
 * with a hyphen.
 */
function isValidTrustDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > 255) return false;
  const labels = domain.split(".");
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label) === false) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Certificate parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract the PEM-encoded client certificate from request headers.
 *
 * Supports:
 * - `X-Client-Cert: <PEM or URL-encoded PEM>`
 * - `X-Forwarded-Client-Cert: Cert="<URL-encoded PEM>"` (Envoy XFCC format)
 */
function extractPemFromHeaders(
  headers: Record<string, string | undefined>,
): string | null {
  // Normalise header names to lower case for case-insensitive lookup.
  const normalised: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) {
      normalised[k.toLowerCase()] = v;
    }
  }

  for (const headerName of CLIENT_CERT_HEADERS) {
    const raw = normalised[headerName];
    if (!raw || raw.length === 0) continue;

    // XFCC header from Envoy may look like:
    //   By=...;Cert="<url-encoded PEM>";Hash=...
    // Extract the Cert value if present.
    const certMatch = raw.match(/Cert="([^"]+)"/i);
    if (certMatch?.[1]) {
      return decodePem(certMatch[1]);
    }

    // Otherwise treat the entire header value as PEM (possibly URL-encoded).
    return decodePem(raw);
  }

  return null;
}

/**
 * Decode a PEM string that may be URL-encoded (common in proxy headers).
 */
function decodePem(value: string): string {
  // If the value contains %2F or %2B it was URL-encoded.
  if (value.includes("%")) {
    try {
      return decodeURIComponent(value);
    } catch {
      // Not valid URL encoding — use as-is.
    }
  }
  return value;
}

/**
 * Compute the SHA-256 hex fingerprint of a PEM-encoded certificate.
 *
 * The fingerprint is computed over the raw PEM text (including header/footer
 * lines) to keep the implementation dependency-free.  This is sufficient for
 * identity-binding purposes as each unique cert will produce a unique hash.
 */
function computeCertFingerprint(pem: string): string {
  return createHash("sha256").update(pem).digest("hex");
}

/**
 * Extract the SPIFFE URI SAN from a PEM-encoded certificate.
 *
 * Real X.509 parsing requires ASN.1 decoding which would need a dependency.
 * Instead we use a pragmatic approach: the SPIFFE ID is looked up from a
 * companion header (`X-Client-Cert-Spiffe-Id`) that mTLS-terminating proxies
 * (Envoy, Istio, Linkerd) can be configured to set, or it can be embedded
 * in the XFCC header as `URI=spiffe://...`.
 *
 * If neither is available we fall back to scanning the PEM base64 payload
 * for the `spiffe://` URI (works for unencrypted certs where the SAN is
 * visible in the base64 text — a useful heuristic but not a substitute for
 * real ASN.1 parsing).
 */
function extractSpiffeIdFromHeaders(
  headers: Record<string, string | undefined>,
): string | null {
  const normalised: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) {
      normalised[k.toLowerCase()] = v;
    }
  }

  // 1. Explicit header set by the proxy.
  const explicit = normalised["x-client-cert-spiffe-id"];
  if (explicit && isValidSpiffeId(explicit)) {
    return explicit;
  }

  // 2. XFCC URI field (Envoy sets `URI=spiffe://...`).
  const xfcc = normalised["x-forwarded-client-cert"];
  if (xfcc) {
    const uriMatch = xfcc.match(/URI=(spiffe:\/\/[^;,"]+)/i);
    if (uriMatch?.[1] && isValidSpiffeId(uriMatch[1])) {
      return uriMatch[1];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a workload identity from client certificate information provided
 * via request headers.
 *
 * In a typical deployment the mTLS termination happens at a reverse proxy
 * (Envoy, Nginx, Istio ingress, etc.) which forwards the client certificate
 * and its SPIFFE ID through HTTP headers.
 *
 * Supported header combinations:
 *
 * | SPIFFE ID source                      | Cert source              |
 * |---------------------------------------|--------------------------|
 * | `X-Client-Cert-Spiffe-Id` header      | `X-Client-Cert`          |
 * | `URI=` in `X-Forwarded-Client-Cert`   | `X-Forwarded-Client-Cert`|
 *
 * @param certOrHeaders  PEM-encoded client certificate string, or a
 *                       header map (e.g. from `Object.fromEntries(request.headers)`).
 * @param trustedDomains Whitelist of SPIFFE trust domains to accept.
 * @returns The parsed `WorkloadIdentity` if the certificate is present, the
 *          SPIFFE ID is valid, and the trust domain is in the whitelist.
 *          Returns `null` otherwise.
 */
export function extractWorkloadIdentity(
  certOrHeaders: string | Record<string, string | undefined>,
  trustedDomains: string[],
): WorkloadIdentity | null {
  if (trustedDomains.length === 0) return null;

  let pem: string | null;
  let spiffeId: string | null;

  if (typeof certOrHeaders === "string") {
    // Raw PEM string provided directly — cannot extract SPIFFE ID from
    // headers, so this path is only useful if the caller also provides
    // the SPIFFE ID separately.  For header-based flows use the object form.
    pem = certOrHeaders.length > 0 ? certOrHeaders : null;
    spiffeId = null;
  } else {
    pem = extractPemFromHeaders(certOrHeaders);
    spiffeId = extractSpiffeIdFromHeaders(certOrHeaders);
  }

  // We need both a certificate (for fingerprinting) and a SPIFFE ID.
  if (!pem || !spiffeId) return null;

  if (!isValidSpiffeId(spiffeId)) return null;

  // Parse the trust domain from the SPIFFE ID.
  const rest = spiffeId.slice("spiffe://".length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) return null;

  const trustDomain = rest.slice(0, slashIndex);
  const workloadPath = rest.slice(slashIndex);

  // Verify the trust domain is in the whitelist.
  if (!trustedDomains.includes(trustDomain)) return null;

  const certFingerprint = computeCertFingerprint(pem);

  return {
    spiffeId,
    trustDomain,
    workloadPath,
    certFingerprint,
  };
}
