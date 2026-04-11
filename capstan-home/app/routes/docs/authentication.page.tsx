import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function Authentication() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Authentication"),

    createElement("p", null,
      "Capstan's auth package (", createElement("code", null, "@zauso-ai/capstan-auth"),
      ") provides dual authentication: JWT sessions for human users and API key authentication for AI agents. ",
      "Both built-in ", createElement("code", null, "createSmartAgent"),
      " agents and external agents accessing your APIs through MCP, A2A, or HTTP can authenticate using API keys."
    ),

    // Overview
    createElement("h2", null, "Overview"),
    createElement("p", null, "The auth middleware resolves credentials from incoming requests in this order:"),
    createElement("ol", null,
      createElement("li", null,
        createElement("strong", null, "Session cookie"),
        " (", createElement("code", null, "capstan_session"), ") -- verifies JWT, returns a human auth context"
      ),
      createElement("li", null,
        createElement("strong", null, "Authorization header"),
        " (", createElement("code", null, "Bearer <token>"),
        ") -- if the token matches the API key prefix, looks up the agent credential and verifies the key hash"
      ),
      createElement("li", null,
        createElement("strong", null, "Anonymous fallback"),
        " -- returns ", createElement("code", null, '{ type: "anonymous", isAuthenticated: false }')
      )
    ),

    // JWT Sessions
    createElement("h2", null, "JWT Sessions"),

    createElement("h3", null, "Signing a Session"),
    createElement("p", null, "Create a signed JWT for a human user after login:"),
    createElement("pre", null,
      createElement("code", null,
`import { signSession } from "@zauso-ai/capstan-auth";

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
  \`capstan_session=\${token}; Path=/; HttpOnly; SameSite=Lax\`,
);`
      )
    ),

    createElement("h3", null, "Session Payload"),
    createElement("pre", null,
      createElement("code", null,
`interface SessionPayload {
  userId: string;
  email?: string;
  role?: string;
  iat: number; // Issued at (Unix timestamp, set automatically)
  exp: number; // Expires at (Unix timestamp, set automatically)
}`
      )
    ),

    createElement("h3", null, "Verifying a Session"),
    createElement("pre", null,
      createElement("code", null,
`import { verifySession } from "@zauso-ai/capstan-auth";

const payload = verifySession(token, process.env.SESSION_SECRET!);
// Returns SessionPayload on success, null on failure
// Checks: HMAC-SHA256 signature, expiration`
      )
    ),
    createElement("p", null, "Verification is timing-safe to prevent timing side-channel attacks."),

    createElement("h3", null, "Duration Format"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Suffix"),
          createElement("th", null, "Unit"),
          createElement("th", null, "Example"),
          createElement("th", null, "Seconds")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "s")),
          createElement("td", null, "seconds"),
          createElement("td", null, createElement("code", null, '"30s"')),
          createElement("td", null, "30")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "m")),
          createElement("td", null, "minutes"),
          createElement("td", null, createElement("code", null, '"30m"')),
          createElement("td", null, "1,800")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "h")),
          createElement("td", null, "hours"),
          createElement("td", null, createElement("code", null, '"1h"')),
          createElement("td", null, "3,600")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "d")),
          createElement("td", null, "days"),
          createElement("td", null, createElement("code", null, '"7d"')),
          createElement("td", null, "604,800")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "w")),
          createElement("td", null, "weeks"),
          createElement("td", null, createElement("code", null, '"2w"')),
          createElement("td", null, "1,209,600")
        )
      )
    ),

    // API Key Authentication
    createElement("h2", null, "API Key Authentication"),
    createElement("p", null,
      "API keys are designed for AI agent authentication -- both external agents calling your ",
      createElement("code", null, "defineAPI()"),
      " endpoints and internal ", createElement("code", null, "createSmartAgent"),
      " instances that need authenticated access. They use a prefix-based lookup scheme for efficient database queries and SHA-256 hashing for secure storage."
    ),

    createElement("h3", null, "Generating an API Key"),
    createElement("pre", null,
      createElement("code", null,
`import { generateApiKey } from "@zauso-ai/capstan-auth";

const { key, hash, prefix } = generateApiKey();
// key:    "cap_ak_a1b2c3d4e5f6..."  (show to user once, never store)
// hash:   "sha256hexdigest..."       (store in database)
// prefix: "cap_ak_a1b2c3d4"         (store for fast DB lookup)`
      )
    ),
    createElement("p", null, "Key structure: 128 bits of entropy (32 hex characters), 8-character lookup prefix for indexed database queries. The default prefix is ",
      createElement("code", null, "cap_ak_"), " and can be customized."
    ),

    createElement("h3", null, "Verifying an API Key"),
    createElement("pre", null,
      createElement("code", null,
`import { verifyApiKey } from "@zauso-ai/capstan-auth";

const isValid = await verifyApiKey(plaintextKey, storedHash);
// Returns boolean, uses timing-safe comparison`
      )
    ),

    createElement("h3", null, "Agent Credential Storage"),
    createElement("pre", null,
      createElement("code", null,
`interface AgentCredential {
  id: string;
  name: string;           // Human-readable agent name
  apiKeyHash: string;     // SHA-256 hex digest
  apiKeyPrefix: string;   // For indexed DB lookup
  permissions: string[];  // e.g. ["ticket:read", "ticket:write"]
  revokedAt?: string;     // ISO timestamp if revoked
}`
      )
    ),

    // Auth Context
    createElement("h2", null, "Auth Context"),
    createElement("p", null, createElement("code", null, "createAuthMiddleware()"),
      " returns a function that resolves auth context from a request:"
    ),
    createElement("pre", null,
      createElement("code", null,
`import { createAuthMiddleware } from "@zauso-ai/capstan-auth";

const resolveAuth = createAuthMiddleware(
  {
    session: {
      secret: process.env.SESSION_SECRET!,
      maxAge: "7d",
    },
    apiKeys: {
      prefix: "cap_ak_",
      headerName: "Authorization",
    },
  },
  {
    findAgentByKeyPrefix: async (prefix) => {
      return db.query.agentCredentials.findFirst({
        where: eq(agentCredentials.apiKeyPrefix, prefix),
      });
    },
  },
);

const authContext = await resolveAuth(request);
// authContext.isAuthenticated: boolean
// authContext.type: "human" | "agent" | "anonymous"`
      )
    ),

    // OAuth Providers
    createElement("h2", null, "OAuth Providers"),
    createElement("p", null,
      "Capstan ships built-in OAuth provider helpers for social login. Use ",
      createElement("code", null, "googleProvider()"), " or ",
      createElement("code", null, "githubProvider()"),
      " to configure a provider, then ", createElement("code", null, "createOAuthHandlers()"),
      " to get route handlers that manage the full authorization code flow."
    ),
    createElement("pre", null,
      createElement("code", null,
`import {
  googleProvider,
  githubProvider,
  createOAuthHandlers,
} from "@zauso-ai/capstan-auth";

const oauthHandlers = createOAuthHandlers({
  providers: [
    googleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    githubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  callbackPath: "/auth/callback",
  sessionSecret: process.env.SESSION_SECRET!,
});`
      )
    ),
    createElement("h3", null, "Login Flow"),
    createElement("ol", null,
      createElement("li", null, "User visits ", createElement("code", null, "/auth/login/google"), " (or ", createElement("code", null, "/auth/login/github"), ")"),
      createElement("li", null, "Capstan sets a ", createElement("code", null, "capstan_oauth_state"), " cookie and redirects to the provider"),
      createElement("li", null, "After the user authorizes, the provider redirects back to ", createElement("code", null, "/auth/callback")),
      createElement("li", null, "Capstan validates the state parameter, exchanges the code for an access token, fetches user info, creates a signed JWT session, and sets the ", createElement("code", null, "capstan_session"), " cookie"),
      createElement("li", null, "User is redirected to ", createElement("code", null, "/"), " as an authenticated human session")
    ),

    // DPoP
    createElement("h2", null, "DPoP (Sender-Constrained Tokens)"),
    createElement("p", null,
      "Capstan supports Demonstrating Proof-of-Possession (RFC 9449) to bind access tokens to a specific client key pair. This prevents token replay if a bearer token is intercepted."
    ),
    createElement("pre", null,
      createElement("code", null,
`auth: {
  session: {
    strategy: "jwt",
    secret: env("SESSION_SECRET"),
    dpop: true, // Require DPoP proof on token-protected requests
  },
},`
      )
    ),
    createElement("p", null,
      "When ", createElement("code", null, "dpop: true"),
      " is set, the auth middleware validates the ", createElement("code", null, "DPoP"),
      " header alongside the ", createElement("code", null, "Authorization"),
      " header. Requests missing a valid DPoP proof receive a ",
      createElement("code", null, "401"), " with a ",
      createElement("code", null, "DPoP-Nonce"), " header for retry."
    ),

    // SPIFFE / mTLS
    createElement("h2", null, "SPIFFE / mTLS (Agent Workload Identity)"),
    createElement("p", null,
      "For service-to-service (agent-to-agent) communication, Capstan supports SPIFFE-based workload identity via mTLS. The ",
      createElement("code", null, "X-Client-Cert"),
      " header (set by a TLS-terminating proxy) is verified against trusted SPIFFE IDs."
    ),
    createElement("pre", null,
      createElement("code", null,
`auth: {
  workloadIdentity: {
    trustDomain: "example.org",
    trustedDomains: ["example.org", "partner.com"],
    certHeader: "X-Client-Cert",
  },
},`
      )
    ),
    createElement("p", null,
      "When a request arrives with a valid client certificate, the auth context is populated with ",
      createElement("code", null, 'type: "agent"'), " and the SPIFFE ID as the agent identifier."
    ),

    // Rate Limiting
    createElement("h2", null, "Rate Limiting"),
    createElement("p", null, createElement("code", null, "defineRateLimit()"),
      " configures request rate limiting with per-auth-type windows:"
    ),
    createElement("pre", null,
      createElement("code", null,
`import { defineRateLimit } from "@zauso-ai/capstan-core";

export const apiLimits = defineRateLimit({
  default: { requests: 100, window: "1m" },
  perAuthType: {
    anonymous: { requests: 20, window: "1m" },
    human: { requests: 200, window: "1m" },
    agent: { requests: 1000, window: "1m" },
  },
});`
      )
    ),
    createElement("p", null, "Apply rate limiting in the config:"),
    createElement("pre", null,
      createElement("code", null,
`export default defineConfig({
  agent: {
    rateLimit: {
      default: { requests: 100, window: "1m" },
      perAgent: true, // Track limits per agent API key
    },
  },
});`
      )
    ),

    // Policies
    createElement("h2", null, "Policies"),
    createElement("p", null,
      "Policies enforce authorization rules on routes. They receive the full auth context and can make decisions based on user identity, role, agent permissions, or any other criteria."
    ),
    createElement("pre", null,
      createElement("code", null,
`import { definePolicy } from "@zauso-ai/capstan-core";

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
});`
      )
    ),
    createElement("p", null, "Apply policies to routes via the ", createElement("code", null, "policy"),
      " field in ", createElement("code", null, "defineAPI()"), ":"
    ),
    createElement("pre", null,
      createElement("code", null,
`export const DELETE = defineAPI({
  capability: "write",
  resource: "ticket",
  policy: "requireAuth",
  async handler({ ctx }) {
    // Only runs if policy allows
    return { deleted: true };
  },
});`
      )
    ),

    // Permission Checking
    createElement("h2", null, "Permission Checking"),
    createElement("p", null,
      "The ", createElement("code", null, "checkPermission()"),
      " function evaluates whether a required permission is satisfied by a set of granted permissions. Permissions follow the ",
      createElement("code", null, "resource:action"), " pattern with wildcard support."
    ),
    createElement("pre", null,
      createElement("code", null,
`import { checkPermission } from "@zauso-ai/capstan-auth";

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
// true`
      )
    ),

    // CSRF Protection
    createElement("h2", null, "CSRF Protection"),
    createElement("p", null, "Capstan uses the ", createElement("code", null, "SameSite=Lax"),
      " cookie attribute by default for session cookies. Additional CSRF guidance:"
    ),
    createElement("ul", null,
      createElement("li", null, "Use ", createElement("code", null, "SameSite=Strict"), " for sensitive operations"),
      createElement("li", null, "Verify the ", createElement("code", null, "Origin"), " or ", createElement("code", null, "Referer"), " header in middleware"),
      createElement("li", null, "API key authentication (used by agents) is inherently CSRF-resistant since tokens are sent in the ",
        createElement("code", null, "Authorization"), " header, not cookies"
      )
    ),

    // Full Configuration Example
    createElement("h2", null, "Configuration Example"),
    createElement("p", null, "Full auth configuration in ", createElement("code", null, "capstan.config.ts"), ":"),
    createElement("pre", null,
      createElement("code", null,
`import { defineConfig, env } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: { name: "my-app" },
  auth: {
    providers: [{ type: "apiKey" }],
    session: {
      strategy: "jwt",
      secret: env("SESSION_SECRET") || crypto.randomUUID(),
      maxAge: "7d",
    },
  },
});`
      )
    )
  );
}
