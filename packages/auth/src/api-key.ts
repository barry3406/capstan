import {
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";

const DEFAULT_PREFIX = "cap_ak_";

/**
 * The number of random hex characters appended after the prefix.
 * 32 hex chars = 16 bytes = 128 bits of entropy.
 */
const RANDOM_HEX_LENGTH = 32;

/**
 * Number of characters from the full key used as a short "prefix" for
 * database look-up (prefix of the *random* portion, after the key prefix).
 */
const LOOKUP_PREFIX_LENGTH = 8;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Generate a new API key suitable for agent authentication.
 *
 * Returns:
 * - `key`    — the full plaintext key (show once to the user, never store)
 * - `hash`   — SHA-256 hex digest of the key (store in the database)
 * - `prefix` — short prefix of the key for fast DB look-up
 */
export function generateApiKey(prefix?: string): {
  key: string;
  hash: string;
  prefix: string;
} {
  const keyPrefix = prefix ?? DEFAULT_PREFIX;
  const randomPart = randomBytes(RANDOM_HEX_LENGTH / 2).toString("hex");
  const key = `${keyPrefix}${randomPart}`;

  const hash = createHash("sha256").update(key).digest("hex");

  // The lookup prefix is the key prefix + the first LOOKUP_PREFIX_LENGTH
  // chars of the random portion, giving enough uniqueness for a DB index.
  const lookupPrefix = `${keyPrefix}${randomPart.slice(0, LOOKUP_PREFIX_LENGTH)}`;

  return { key, hash, prefix: lookupPrefix };
}

/**
 * Verify a plaintext API key against a stored SHA-256 hash.
 *
 * Uses timing-safe comparison to prevent timing side-channel attacks.
 */
export async function verifyApiKey(
  key: string,
  storedHash: string,
): Promise<boolean> {
  const candidateHash = createHash("sha256").update(key).digest("hex");

  const a = Buffer.from(candidateHash, "utf-8");
  const b = Buffer.from(storedHash, "utf-8");

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Extract the lookup prefix from a full plaintext API key.
 *
 * This prefix can be used to find the matching credential row in the
 * database without hashing first (the hash is checked afterwards).
 */
export function extractApiKeyPrefix(key: string): string {
  // Detect the structural prefix (everything before the random hex).
  // We look for the pattern: one or more segments ending with "_" followed
  // by hex characters.
  const structuralMatch = key.match(/^([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*_)/);
  const structuralPrefix = structuralMatch?.[1] ?? DEFAULT_PREFIX;
  const randomPart = key.slice(structuralPrefix.length);

  return `${structuralPrefix}${randomPart.slice(0, LOOKUP_PREFIX_LENGTH)}`;
}
