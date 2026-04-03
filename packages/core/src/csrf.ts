import type { Context, Next } from "hono";

// ---------------------------------------------------------------------------
// CSRF Protection Middleware (Double Submit Cookie)
// ---------------------------------------------------------------------------

const CSRF_COOKIE_NAME = "__csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/**
 * Generate a cryptographically random CSRF token (32 hex characters).
 */
async function generateCsrfToken(): Promise<string> {
  const runtimeCrypto = globalThis.crypto;
  if (runtimeCrypto && typeof runtimeCrypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    runtimeCrypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  const { randomBytes } = await import("node:crypto");
  return randomBytes(16).toString("hex");
}

/**
 * Parse cookies from a `Cookie` header string and return the value for the
 * given cookie name, or `undefined` if not found.
 */
function getCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (key === name) return value;
  }
  return undefined;
}

/**
 * Create a Hono middleware that enforces Double Submit Cookie CSRF protection.
 *
 * **GET / HEAD / OPTIONS** requests:
 * - A fresh CSRF token is generated, set as the `__csrf` cookie
 *   (`HttpOnly=false` so client-side JS can read it), and echoed in the
 *   `X-CSRF-Token` response header.
 *
 * **POST / PUT / DELETE / PATCH** requests:
 * - The middleware verifies that the `X-CSRF-Token` request header matches
 *   the `__csrf` cookie. On mismatch (or either value missing) the request
 *   is rejected with a `403` response.
 * - Requests that carry a `Bearer` token in the `Authorization` header are
 *   **exempt** from CSRF checks because they are not cookie-based.
 */
export function csrfProtection() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const method = c.req.method.toUpperCase();

    // Requests authenticated via Bearer token skip CSRF — they are not
    // vulnerable to cross-site request forgery because the token is not
    // sent automatically by the browser.
    const authHeader = c.req.header("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      await next();
      return;
    }

    if (STATE_CHANGING_METHODS.has(method)) {
      // --- Validate CSRF token on state-changing requests ---
      const cookieToken = getCookieValue(
        c.req.header("cookie"),
        CSRF_COOKIE_NAME,
      );
      const headerToken = c.req.header(CSRF_HEADER_NAME);

      if (
        !cookieToken ||
        !headerToken ||
        cookieToken !== headerToken
      ) {
        return c.json({ error: "CSRF token mismatch" }, 403);
      }

      await next();
    } else {
      // --- Issue a fresh token on safe requests ---
      const token = await generateCsrfToken();

      await next();

      // Set the cookie and header after downstream handlers have run so that
      // the response object already exists.
      c.header(CSRF_HEADER_NAME, token);
      c.header(
        "Set-Cookie",
        `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=Lax`,
      );
    }
  };
}
