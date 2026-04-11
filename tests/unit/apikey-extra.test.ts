import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import {
  generateApiKey,
  verifyApiKey,
  extractApiKeyPrefix,
} from "@zauso-ai/capstan-auth";

// ---------------------------------------------------------------------------
// generateApiKey — additional coverage
// ---------------------------------------------------------------------------

describe("generateApiKey — extra", () => {
  it("key is exactly prefix length + 32 hex chars", () => {
    const { key } = generateApiKey();
    // default prefix "cap_ak_" = 7 chars, random = 32 hex chars
    expect(key.length).toBe(7 + 32);
  });

  it("custom prefix key has correct total length", () => {
    const { key } = generateApiKey("myapp_secret_");
    expect(key.length).toBe("myapp_secret_".length + 32);
  });

  it("random portion contains only hex characters", () => {
    const { key } = generateApiKey();
    const randomPart = key.slice("cap_ak_".length);
    expect(/^[0-9a-f]{32}$/.test(randomPart)).toBe(true);
  });

  it("hash is a valid SHA-256 hex digest of the full key", () => {
    const { key, hash } = generateApiKey();
    const expected = createHash("sha256").update(key).digest("hex");
    expect(hash).toBe(expected);
  });

  it("lookup prefix is key prefix + first 8 chars of random part", () => {
    const { key, prefix } = generateApiKey("test_");
    const randomPart = key.slice("test_".length);
    expect(prefix).toBe(`test_${randomPart.slice(0, 8)}`);
  });

  it("generates 10 unique keys with the same prefix", () => {
    const keys = new Set<string>();
    const hashes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { key, hash } = generateApiKey("batch_");
      keys.add(key);
      hashes.add(hash);
    }
    expect(keys.size).toBe(10);
    expect(hashes.size).toBe(10);
  });

  it("accepts a single-character prefix", () => {
    const { key } = generateApiKey("x");
    expect(key.startsWith("x")).toBe(true);
    expect(key.length).toBe(1 + 32);
  });

  it("accepts a prefix with trailing underscore", () => {
    const { key, prefix } = generateApiKey("my_app_");
    expect(key.startsWith("my_app_")).toBe(true);
    expect(prefix.startsWith("my_app_")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyApiKey — additional coverage
// ---------------------------------------------------------------------------

describe("verifyApiKey — extra", () => {
  it("returns false for an empty key", async () => {
    const { hash } = generateApiKey();
    const result = await verifyApiKey("", hash);
    expect(result).toBe(false);
  });

  it("returns false for an empty stored hash", async () => {
    const { key } = generateApiKey();
    const result = await verifyApiKey(key, "");
    expect(result).toBe(false);
  });

  it("returns false when both key and hash are empty", async () => {
    const result = await verifyApiKey("", "");
    expect(result).toBe(false);
  });

  it("returns false for a key that differs by one character", async () => {
    const { key, hash } = generateApiKey();
    // Flip the last character
    const lastChar = key[key.length - 1]!;
    const flipped = lastChar === "a" ? "b" : "a";
    const alteredKey = key.slice(0, -1) + flipped;
    const result = await verifyApiKey(alteredKey, hash);
    expect(result).toBe(false);
  });

  it("returns true for the same key verified twice", async () => {
    const { key, hash } = generateApiKey();
    expect(await verifyApiKey(key, hash)).toBe(true);
    expect(await verifyApiKey(key, hash)).toBe(true);
  });

  it("returns false when stored hash has wrong length", async () => {
    const { key } = generateApiKey();
    // SHA-256 hex is 64 chars; provide 63
    const shortHash = "a".repeat(63);
    const result = await verifyApiKey(key, shortHash);
    expect(result).toBe(false);
  });

  it("returns false for a hash of a different key", async () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    const result = await verifyApiKey(key1.key, key2.hash);
    expect(result).toBe(false);
  });

  it("hash comparison is case-sensitive (uppercase hash fails)", async () => {
    const { key, hash } = generateApiKey();
    const upperHash = hash.toUpperCase();
    // SHA-256 hex from Node is lowercase; uppercase should fail
    const result = await verifyApiKey(key, upperHash);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractApiKeyPrefix — additional coverage
// ---------------------------------------------------------------------------

describe("extractApiKeyPrefix — extra", () => {
  it("extracts consistent prefix regardless of key generation order", () => {
    const { key, prefix } = generateApiKey();
    // Extract prefix multiple times — should be deterministic
    expect(extractApiKeyPrefix(key)).toBe(prefix);
    expect(extractApiKeyPrefix(key)).toBe(prefix);
  });

  it("handles multi-segment prefixes (e.g., org_team_key_)", () => {
    const { key, prefix } = generateApiKey("org_team_key_");
    const extracted = extractApiKeyPrefix(key);
    expect(extracted).toBe(prefix);
    expect(extracted.startsWith("org_team_key_")).toBe(true);
  });

  it("prefix length is structural prefix + 8 chars of random part", () => {
    const structPrefix = "cap_ak_";
    const { key, prefix } = generateApiKey(structPrefix);
    expect(prefix.length).toBe(structPrefix.length + 8);
    // extractApiKeyPrefix should match
    expect(extractApiKeyPrefix(key)).toBe(prefix);
  });

  it("two keys with same prefix produce different lookup prefixes (usually)", () => {
    // With 128 bits of entropy, collision is astronomically unlikely
    const prefixes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { key } = generateApiKey();
      prefixes.add(extractApiKeyPrefix(key));
    }
    expect(prefixes.size).toBe(20);
  });
});
