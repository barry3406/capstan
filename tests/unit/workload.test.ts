import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  isValidSpiffeId,
  extractWorkloadIdentity,
} from "@zauso-ai/capstan-auth";

// ---------------------------------------------------------------------------
// isValidSpiffeId
// ---------------------------------------------------------------------------

describe("isValidSpiffeId", () => {
  // ---- Valid IDs ----------------------------------------------------------

  it("accepts a standard SPIFFE ID", () => {
    expect(isValidSpiffeId("spiffe://example.org/agent/crawler")).toBe(true);
  });

  it("accepts a multi-label trust domain", () => {
    expect(isValidSpiffeId("spiffe://prod.example.com/service/api")).toBe(true);
  });

  it("accepts a single-char trust domain", () => {
    expect(isValidSpiffeId("spiffe://a/path")).toBe(true);
  });

  it("accepts a deeply nested workload path", () => {
    expect(isValidSpiffeId("spiffe://example.org/ns/prod/sa/crawler")).toBe(true);
  });

  // ---- Invalid: scheme ---------------------------------------------------

  it("rejects missing spiffe:// prefix", () => {
    expect(isValidSpiffeId("example.org/agent/crawler")).toBe(false);
  });

  it("rejects http:// scheme", () => {
    expect(isValidSpiffeId("http://example.org/agent")).toBe(false);
  });

  it("rejects https:// scheme", () => {
    expect(isValidSpiffeId("https://example.org/agent")).toBe(false);
  });

  // ---- Invalid: trust domain ---------------------------------------------

  it("rejects empty trust domain (spiffe:///path)", () => {
    expect(isValidSpiffeId("spiffe:///agent/crawler")).toBe(false);
  });

  it("rejects trust domain with uppercase letters", () => {
    expect(isValidSpiffeId("spiffe://Example.Org/agent/crawler")).toBe(false);
  });

  it("rejects trust domain with underscores", () => {
    expect(isValidSpiffeId("spiffe://my_domain.org/agent/crawler")).toBe(false);
  });

  it("rejects trust domain with leading hyphen", () => {
    expect(isValidSpiffeId("spiffe://-example.org/agent")).toBe(false);
  });

  it("rejects trust domain with trailing hyphen", () => {
    expect(isValidSpiffeId("spiffe://example-.org/agent")).toBe(false);
  });

  it("rejects trust domain with empty label (consecutive dots)", () => {
    expect(isValidSpiffeId("spiffe://example..org/agent")).toBe(false);
  });

  // ---- Invalid: workload path -------------------------------------------

  it("rejects empty workload path (just spiffe://domain)", () => {
    expect(isValidSpiffeId("spiffe://example.org")).toBe(false);
  });

  it("rejects workload path with only a slash (spiffe://domain/)", () => {
    expect(isValidSpiffeId("spiffe://example.org/")).toBe(false);
  });

  it("rejects workload path with .. traversal segments", () => {
    expect(isValidSpiffeId("spiffe://example.org/../etc/passwd")).toBe(false);
  });

  it("rejects workload path with . segment", () => {
    expect(isValidSpiffeId("spiffe://example.org/./agent")).toBe(false);
  });

  it("rejects double slashes in path", () => {
    expect(isValidSpiffeId("spiffe://example.org/agent//crawler")).toBe(false);
  });

  // ---- Boundary: trust domain length ------------------------------------

  it("rejects trust domain longer than 255 characters", () => {
    // Build a domain with labels of 63 chars each separated by dots,
    // exceeding 255 total.
    const label = "a".repeat(63);
    const longDomain = `${label}.${label}.${label}.${label}.${label}`;
    expect(longDomain.length).toBeGreaterThan(255);
    expect(isValidSpiffeId(`spiffe://${longDomain}/agent`)).toBe(false);
  });

  it("rejects a single trust domain label longer than 63 characters", () => {
    const longLabel = "a".repeat(64);
    expect(isValidSpiffeId(`spiffe://${longLabel}/agent`)).toBe(false);
  });

  it("accepts trust domain at exactly 255 characters", () => {
    // 4 labels of 63 chars + 3 dots = 255
    const label = "a".repeat(63);
    const domain = `${label}.${label}.${label}.${label}`;
    expect(domain.length).toBe(255);
    expect(isValidSpiffeId(`spiffe://${domain}/agent`)).toBe(true);
  });

  // ---- Edge cases -------------------------------------------------------

  it("rejects empty string", () => {
    expect(isValidSpiffeId("")).toBe(false);
  });

  it("rejects non-string input", () => {
    // TypeScript normally prevents this, but runtime defensiveness matters.
    expect(isValidSpiffeId(null as unknown as string)).toBe(false);
    expect(isValidSpiffeId(undefined as unknown as string)).toBe(false);
    expect(isValidSpiffeId(42 as unknown as string)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractWorkloadIdentity
// ---------------------------------------------------------------------------

const SAMPLE_PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBkTCB+wIJALRiMLAh0GRIMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMMBnNl",
  "cnZlcjAeFw0yNDAxMDEwMDAwMDBaFw0yNTAxMDEwMDAwMDBaMBExDzANBgNVBAMM",
  "BnNlcnZlcjBcMA0GCSqGSIb3DQEBAQUAAktAMEgCQQDK",
  "-----END CERTIFICATE-----",
].join("\n");

const TRUSTED_DOMAINS = ["example.org", "prod.example.com"];

describe("extractWorkloadIdentity", () => {
  // ---- Extraction from X-Client-Cert-Spiffe-Id -------------------------

  it("extracts identity from X-Client-Cert-Spiffe-Id header", () => {
    const headers: Record<string, string> = {
      "X-Client-Cert-Spiffe-Id": "spiffe://example.org/agent/crawler",
      "X-Client-Cert": SAMPLE_PEM,
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);

    expect(result).not.toBeNull();
    expect(result!.spiffeId).toBe("spiffe://example.org/agent/crawler");
    expect(result!.trustDomain).toBe("example.org");
    expect(result!.workloadPath).toBe("/agent/crawler");
    expect(typeof result!.certFingerprint).toBe("string");
    expect(result!.certFingerprint.length).toBe(64); // SHA-256 hex
  });

  // ---- Extraction from XFCC (Envoy format) ------------------------------

  it("extracts identity from X-Forwarded-Client-Cert URI field", () => {
    const headers: Record<string, string> = {
      "X-Forwarded-Client-Cert":
        `By=spiffe://mesh.local/ingress;URI=spiffe://example.org/service/api;Cert="${encodeURIComponent(SAMPLE_PEM)}"`,
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);

    expect(result).not.toBeNull();
    expect(result!.spiffeId).toBe("spiffe://example.org/service/api");
    expect(result!.trustDomain).toBe("example.org");
    expect(result!.workloadPath).toBe("/service/api");
  });

  // ---- Null returns -----------------------------------------------------

  it("returns null when no cert headers present", () => {
    const headers: Record<string, string> = {
      "Authorization": "Bearer some-token",
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);
    expect(result).toBeNull();
  });

  it("returns null when trust domain not in whitelist", () => {
    const headers: Record<string, string> = {
      "X-Client-Cert-Spiffe-Id": "spiffe://untrusted.evil.com/agent/hack",
      "X-Client-Cert": SAMPLE_PEM,
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);
    expect(result).toBeNull();
  });

  it("returns null with empty whitelist", () => {
    const headers: Record<string, string> = {
      "X-Client-Cert-Spiffe-Id": "spiffe://example.org/agent/crawler",
      "X-Client-Cert": SAMPLE_PEM,
    };
    const result = extractWorkloadIdentity(headers, []);
    expect(result).toBeNull();
  });

  it("returns null when SPIFFE ID header present but no cert", () => {
    const headers: Record<string, string> = {
      "X-Client-Cert-Spiffe-Id": "spiffe://example.org/agent/crawler",
      // No X-Client-Cert or X-Forwarded-Client-Cert
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);
    expect(result).toBeNull();
  });

  it("returns null when cert present but no SPIFFE ID", () => {
    const headers: Record<string, string> = {
      "X-Client-Cert": SAMPLE_PEM,
      // No X-Client-Cert-Spiffe-Id or XFCC with URI=
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);
    expect(result).toBeNull();
  });

  it("returns null when SPIFFE ID is malformed", () => {
    const headers: Record<string, string> = {
      "X-Client-Cert-Spiffe-Id": "http://example.org/agent",
      "X-Client-Cert": SAMPLE_PEM,
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);
    expect(result).toBeNull();
  });

  // ---- PEM fingerprinting -----------------------------------------------

  it("computes cert fingerprint from X-Client-Cert PEM", () => {
    const headers: Record<string, string> = {
      "X-Client-Cert-Spiffe-Id": "spiffe://example.org/agent/crawler",
      "X-Client-Cert": SAMPLE_PEM,
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);
    expect(result).not.toBeNull();

    // Fingerprint should be a stable SHA-256 hex digest of the PEM
    const { createHash } = require("node:crypto");
    const expectedFingerprint = createHash("sha256")
      .update(SAMPLE_PEM)
      .digest("hex");
    expect(result!.certFingerprint).toBe(expectedFingerprint);
  });

  // ---- URL-encoded PEM in XFCC ------------------------------------------

  it("handles URL-encoded PEM in XFCC Cert field", () => {
    const encodedPem = encodeURIComponent(SAMPLE_PEM);
    const headers: Record<string, string> = {
      "X-Forwarded-Client-Cert":
        `URI=spiffe://prod.example.com/service/api;Cert="${encodedPem}"`,
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);

    expect(result).not.toBeNull();
    expect(result!.spiffeId).toBe("spiffe://prod.example.com/service/api");
    // Fingerprint should be computed from the decoded PEM
    const { createHash } = require("node:crypto");
    const expectedFingerprint = createHash("sha256")
      .update(SAMPLE_PEM)
      .digest("hex");
    expect(result!.certFingerprint).toBe(expectedFingerprint);
  });

  // ---- Case-insensitive headers -----------------------------------------

  it("matches headers case-insensitively", () => {
    const headers: Record<string, string> = {
      "x-client-cert-spiffe-id": "spiffe://example.org/agent/crawler",
      "x-client-cert": SAMPLE_PEM,
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);
    expect(result).not.toBeNull();
    expect(result!.spiffeId).toBe("spiffe://example.org/agent/crawler");
  });

  it("matches headers with mixed case", () => {
    const headers: Record<string, string> = {
      "X-CLIENT-CERT-SPIFFE-ID": "spiffe://example.org/agent/crawler",
      "X-CLIENT-CERT": SAMPLE_PEM,
    };
    const result = extractWorkloadIdentity(headers, TRUSTED_DOMAINS);
    expect(result).not.toBeNull();
  });

  // ---- Raw PEM string path (no SPIFFE ID) --------------------------------

  it("returns null when called with a raw PEM string (no SPIFFE ID source)", () => {
    // The string overload cannot extract a SPIFFE ID from headers.
    const result = extractWorkloadIdentity(SAMPLE_PEM, TRUSTED_DOMAINS);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Security edge cases
// ---------------------------------------------------------------------------

/** A minimal self-signed PEM for testing (just needs to be valid PEM-shaped). */
const FAKE_PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBkTCB+wIUZ0IyRj0Z2YzH3x5vJqLF1cU2DhMwDQYJKoZIhvcNAQELBQAwFD",
  "ESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI1MDEwMTAwMDAwMFoXDTI2MDEwMTAwMD",
  "AwMFowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQ",
  "cDQgAEexampleKeyDataHereForTestingOnlyNotARealCertificateButHasValidP",
  "EMStructureForParsingPurposesAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "-----END CERTIFICATE-----",
].join("\n");

/** A second distinct PEM for comparison tests. */
const FAKE_PEM_2 = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBkTCB+wIUZ0IyRj0Z2YzH3x5vJqLF1cU2DhMwDQYJKoZIhvcNAQELBQAwFD",
  "ESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI1MDEwMTAwMDAwMFoXDTI2MDEwMTAwMD",
  "AwMFowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQ",
  "cDQgAEdifferentKeyDataHereForTestingNotARealCertificateButHasValidPEM",
  "StructureForParsingPurposesAndIsDifferentFromTheFirstOneUsedAboveAAAA",
  "-----END CERTIFICATE-----",
].join("\n");

const SEC_TRUSTED_DOMAINS = ["example.org"];

function computeFingerprint(pem: string): string {
  return createHash("sha256").update(pem).digest("hex");
}

function urlEncodePem(pem: string): string {
  return encodeURIComponent(pem);
}

describe("extractWorkloadIdentity — security edge cases", () => {
  // ── 6. Header priority: explicit header wins over XFCC URI ─────────────
  it("prefers X-Client-Cert-Spiffe-Id over XFCC URI when both present with different IDs", () => {
    const explicitId = "spiffe://example.org/agent/explicit";
    const xfccId = "spiffe://example.org/agent/xfcc";

    const headers: Record<string, string> = {
      "X-Client-Cert-Spiffe-Id": explicitId,
      "X-Client-Cert": FAKE_PEM,
      "X-Forwarded-Client-Cert": `URI=${xfccId};Cert="${urlEncodePem(FAKE_PEM_2)}"`,
    };

    const result = extractWorkloadIdentity(headers, SEC_TRUSTED_DOMAINS);
    expect(result).not.toBeNull();
    // The explicit header should win over the XFCC URI.
    expect(result!.spiffeId).toBe(explicitId);
    expect(result!.workloadPath).toBe("/agent/explicit");
  });

  // ── 7. XFCC with URI but no Cert field ─────────────────────────────────
  it("uses the raw XFCC value as PEM when Cert field is absent", () => {
    const xfccValue = "URI=spiffe://example.org/agent/nocert";
    const headers: Record<string, string> = {
      "X-Forwarded-Client-Cert": xfccValue,
    };

    const result = extractWorkloadIdentity(headers, SEC_TRUSTED_DOMAINS);
    expect(result).not.toBeNull();
    expect(result!.spiffeId).toBe("spiffe://example.org/agent/nocert");
    // The fingerprint is computed over the raw XFCC value (used as PEM).
    expect(result!.certFingerprint).toBe(computeFingerprint(xfccValue));
  });

  // ── 8. Malformed URL encoding in PEM ───────────────────────────────────
  it("handles malformed URL encoding gracefully (invalid %ZZ sequence)", () => {
    const malformedPem = "-----BEGIN CERTIFICATE-----%ZZ%ZZ-----END CERTIFICATE-----";
    const headers: Record<string, string> = {
      "X-Client-Cert-Spiffe-Id": "spiffe://example.org/agent/test",
      "X-Client-Cert": malformedPem,
    };

    // Should not throw — decodePem catches the error.
    const result = extractWorkloadIdentity(headers, SEC_TRUSTED_DOMAINS);
    expect(result).not.toBeNull();
    expect(result!.spiffeId).toBe("spiffe://example.org/agent/test");
    // The fingerprint is computed over the raw (un-decoded) value.
    expect(result!.certFingerprint).toBe(computeFingerprint(malformedPem));
  });

  // ── 9. XFCC fingerprint verification ──────────────────────────────────
  it("returns the correct certFingerprint for XFCC-provided certificates", () => {
    const spiffeId = "spiffe://example.org/agent/crawler";
    const encodedPem = urlEncodePem(FAKE_PEM);

    const headers: Record<string, string> = {
      "X-Forwarded-Client-Cert": `URI=${spiffeId};Cert="${encodedPem}"`,
    };

    const result = extractWorkloadIdentity(headers, SEC_TRUSTED_DOMAINS);
    expect(result).not.toBeNull();
    expect(result!.spiffeId).toBe(spiffeId);
    // Verify the fingerprint is the SHA-256 hex digest of the decoded PEM.
    const expectedFingerprint = computeFingerprint(FAKE_PEM);
    expect(result!.certFingerprint).toBe(expectedFingerprint);
    // Double-check it looks like a valid SHA-256 hex string (64 hex chars).
    expect(result!.certFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
