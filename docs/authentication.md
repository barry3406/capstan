# Authentication

Capstan's auth package (`@zauso-ai/capstan-auth`) provides dual authentication: JWT sessions for human users and API key authentication for AI agents.

## Overview

The auth middleware resolves credentials from incoming requests in this order:

1. **Session cookie** (`capstan_session`) -- verifies JWT, returns a human auth context
2. **Authorization header** (`Bearer <token>`) -- if the token matches the API key prefix, looks up the agent credential and verifies the key hash
3. **Anonymous fallback** -- returns `{ type: "anonymous", isAuthenticated: false }`

## JWT Sessions

### Signing a Session

Create a signed JWT for a human user after login:

```typescript
import { signSession } from "@zauso-ai/capstan-auth";

const token = signSession(
  {
    userId: "user_123",
    email: "alice@example.com",
    role: "admin",
  },
  process.env.SESSION_SECRET!,
  "7d", // max age (optional, defaults to "7d")
);

// Set as cookie in response
response.headers.set(
  "Set-Cookie",
  `capstan_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
);
```

### Session Payload

```typescript
interface SessionPayload {
  userId: string;
  email?: string;
  role?: string;
  iat: number; // Issued at (Unix timestamp, set automatically)
  exp: number; // Expires at (Unix timestamp, set automatically)
}
```

### Verifying a Session

```typescript
import { verifySession } from "@zauso-ai/capstan-auth";

const payload = verifySession(token, process.env.SESSION_SECRET!);
// Returns SessionPayload on success, null on failure
// Checks: HMAC-SHA256 signature, expiration
```

Verification is timing-safe to prevent timing side-channel attacks.

### Duration Format

The `maxAge` parameter accepts human-friendly duration strings:

| Suffix | Unit    | Example    | Seconds |
| ------ | ------- | ---------- | ------- |
| `s`    | seconds | `"30s"`    | 30      |
| `m`    | minutes | `"30m"`    | 1,800   |
| `h`    | hours   | `"1h"`     | 3,600   |
| `d`    | days    | `"7d"`     | 604,800 |
| `w`    | weeks   | `"2w"`     | 1,209,600 |

## API Key Authentication

API keys are designed for AI agent authentication. They use a prefix-based lookup scheme for efficient database queries and SHA-256 hashing for secure storage.

### Generating an API Key

```typescript
import { generateApiKey } from "@zauso-ai/capstan-auth";

const { key, hash, prefix } = generateApiKey();
// key:    "cap_ak_a1b2c3d4e5f6..."  (show to user once, never store)
// hash:   "sha256hexdigest..."       (store in database)
// prefix: "cap_ak_a1b2c3d4"         (store for fast DB lookup)
```

The default key prefix is `cap_ak_`. You can customize it:

```typescript
const { key, hash, prefix } = generateApiKey("myapp_");
// key: "myapp_a1b2c3d4e5f6..."
```

Key structure:
- 128 bits of entropy (32 hex characters of random data)
- 8-character lookup prefix for indexed database queries

### Verifying an API Key

```typescript
import { verifyApiKey } from "@zauso-ai/capstan-auth";

const isValid = await verifyApiKey(plaintextKey, storedHash);
// Returns boolean, uses timing-safe comparison
```

### Agent Credential Storage

Store agent credentials with this shape:

```typescript
interface AgentCredential {
  id: string;
  name: string;           // Human-readable agent name
  apiKeyHash: string;     // SHA-256 hex digest
  apiKeyPrefix: string;   // For indexed DB lookup
  permissions: string[];  // e.g. ["ticket:read", "ticket:write"]
  revokedAt?: string;     // ISO timestamp if revoked
}
```

### Extracting a Key Prefix

To look up a credential by prefix before hashing:

```typescript
import { extractApiKeyPrefix } from "@zauso-ai/capstan-auth";

const prefix = extractApiKeyPrefix("cap_ak_a1b2c3d4e5f67890abcdef...");
// Returns "cap_ak_a1b2c3d4"
```

## Auth Middleware

`createAuthMiddleware()` returns a function that resolves auth context from a request:

```typescript
import { createAuthMiddleware } from "@zauso-ai/capstan-auth";

const resolveAuth = createAuthMiddleware(
  {
    session: {
      secret: process.env.SESSION_SECRET!,
      maxAge: "7d",
    },
    apiKeys: {
      prefix: "cap_ak_",         // optional, default "cap_ak_"
      headerName: "Authorization", // optional, default "Authorization"
    },
  },
  {
    // Look up agent credential by key prefix
    findAgentByKeyPrefix: async (prefix) => {
      return db.query.agentCredentials.findFirst({
        where: eq(agentCredentials.apiKeyPrefix, prefix),
      });
    },
  },
);

// Use in a route handler or middleware
const authContext = await resolveAuth(request);
// authContext.isAuthenticated: boolean
// authContext.type: "human" | "agent" | "anonymous"
```

### Auth Configuration

```typescript
interface AuthConfig {
  session: {
    secret: string;     // HMAC signing secret (required)
    maxAge?: string;    // Session duration, e.g. "7d"
  };
  apiKeys?: {
    prefix?: string;    // Key prefix, default "cap_ak_"
    headerName?: string; // Header name, default "Authorization"
  };
}
```

## Authorization with definePolicy()

Policies enforce authorization rules on routes. They receive the full auth context and can make decisions based on user identity, role, agent permissions, or any other criteria.

```typescript
import { definePolicy } from "@zauso-ai/capstan-core";

// Require any authenticated user
export const requireAuth = definePolicy({
  key: "requireAuth",
  title: "Require Authentication",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.isAuthenticated) {
      return { effect: "deny", reason: "Authentication required" };
    }
    return { effect: "allow" };
  },
});

// Require human approval for agent write actions
export const agentApproval = definePolicy({
  key: "agentApproval",
  title: "Agent Approval Required",
  effect: "approve",
  async check({ ctx }) {
    if (ctx.auth.type === "agent") {
      return {
        effect: "approve",
        reason: "Agent write actions require human approval",
      };
    }
    return { effect: "allow" };
  },
});
```

Apply policies to routes via the `policy` field in `defineAPI()`:

```typescript
export const DELETE = defineAPI({
  capability: "write",
  resource: "ticket",
  policy: "requireAuth",
  async handler({ ctx }) {
    // Only runs if policy allows
    return { deleted: true };
  },
});
```

## Permission Checking

The `checkPermission()` function evaluates whether a required permission is satisfied by a set of granted permissions. Permissions follow the `resource:action` pattern with wildcard support.

```typescript
import { checkPermission } from "@zauso-ai/capstan-auth";

// Exact match
checkPermission({ resource: "ticket", action: "read" }, ["ticket:read"]);
// true

// Wildcard resource
checkPermission({ resource: "ticket", action: "write" }, ["*:write"]);
// true

// Wildcard action
checkPermission({ resource: "ticket", action: "delete" }, ["ticket:*"]);
// true

// Superuser
checkPermission({ resource: "ticket", action: "delete" }, ["*:*"]);
// true
```

The `derivePermission()` helper maps capability modes to permission objects:

```typescript
import { derivePermission } from "@zauso-ai/capstan-auth";

derivePermission("read", "ticket");
// { resource: "ticket", action: "read" }

derivePermission("write", "ticket");
// { resource: "ticket", action: "write" }

derivePermission("external");
// { resource: "external", action: "write" }
```

## DPoP (Sender-Constrained Tokens)

Capstan supports Demonstrating Proof-of-Possession (RFC 9449) to bind access tokens to a specific client key pair. This prevents token replay if a bearer token is intercepted.

Enable DPoP in the auth config:

```typescript
auth: {
  session: {
    strategy: "jwt",
    secret: env("SESSION_SECRET"),
    dpop: true, // Require DPoP proof on token-protected requests
  },
},
```

When `dpop: true` is set, the auth middleware validates the `DPoP` header alongside the `Authorization` header. Requests missing a valid DPoP proof receive a `401` with a `DPoP-Nonce` header for retry.

## Agent Workload Identity

For service-to-service (agent-to-agent) communication, Capstan supports SPIFFE-based workload identity via mTLS. The `X-Client-Cert` header (set by a TLS-terminating proxy) is verified against trusted SPIFFE IDs.

```typescript
auth: {
  workloadIdentity: {
    trustDomain: "example.org",
    trustedDomains: ["example.org", "partner.com"],
    certHeader: "X-Client-Cert", // default
  },
},
```

The `trustedDomains` option restricts which SPIFFE trust domains are accepted. When a request arrives with a valid client certificate, the auth context is populated with `type: "agent"` and the SPIFFE ID as the agent identifier.

## Rate Limiting

`defineRateLimit()` configures request rate limiting with per-auth-type windows:

```typescript
import { defineRateLimit } from "@zauso-ai/capstan-core";

export const apiLimits = defineRateLimit({
  default: { requests: 100, window: "1m" },
  perAuthType: {
    anonymous: { requests: 20, window: "1m" },
    human: { requests: 200, window: "1m" },
    agent: { requests: 1000, window: "1m" },
  },
});
```

Apply rate limiting in the config:

```typescript
export default defineConfig({
  agent: {
    rateLimit: {
      default: { requests: 100, window: "1m" },
      perAgent: true, // Track limits per agent API key
    },
  },
});
```

## CSRF Protection

Capstan uses the `SameSite=Lax` cookie attribute by default for session cookies. For additional CSRF protection in production:

- Use `SameSite=Strict` for sensitive operations
- Verify the `Origin` or `Referer` header in middleware
- API key authentication (used by agents) is inherently CSRF-resistant since tokens are sent in the `Authorization` header, not cookies

## Configuration Example

Full auth configuration in `capstan.config.ts`:

```typescript
import { defineConfig, env } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: {
    name: "my-app",
  },
  auth: {
    providers: [
      { type: "apiKey" },
    ],
    session: {
      strategy: "jwt",
      secret: env("SESSION_SECRET") || crypto.randomUUID(),
      maxAge: "7d",
    },
  },
});
```
