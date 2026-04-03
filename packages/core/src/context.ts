import type { Context as HonoContext } from "hono";
import type { CapstanAuthContext, CapstanContext } from "./types.js";

/**
 * Build a CapstanContext from the raw Hono request context.
 *
 * Auth defaults to anonymous. The real auth layer (@zauso-ai/capstan-auth) replaces
 * the auth object via middleware before any handler runs.
 */
export function createContext(honoCtx: HonoContext): CapstanContext {
  const anonymousAuth: CapstanAuthContext = {
    isAuthenticated: false,
    type: "anonymous",
    permissions: [],
  };

  // If middleware has already attached auth info, use it; otherwise anonymous.
  const existingAuth = honoCtx.get("capstanAuth") as
    | CapstanAuthContext
    | undefined;

  return {
    auth: existingAuth ?? anonymousAuth,
    request: honoCtx.req.raw,
    env: (
      typeof process !== "undefined" && process.env
        ? process.env
        : {}
    ) as Record<string, string | undefined>,
    honoCtx,
  };
}
