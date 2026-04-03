import type { Context as HonoContext } from "hono";
import type { CapstanAuthContext, CapstanContext } from "./types.js";
import { createRequestIdentity } from "./ops.js";

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
    grants: [],
    delegation: [],
    actor: {
      kind: "anonymous",
      id: "anonymous",
      displayName: "Anonymous",
    },
    credential: {
      kind: "anonymous",
      subjectId: "anonymous",
      presentedAt: new Date(0).toISOString(),
    },
    envelope: {
      actor: {
        kind: "anonymous",
        id: "anonymous",
        displayName: "Anonymous",
      },
      credential: {
        kind: "anonymous",
        subjectId: "anonymous",
        presentedAt: new Date(0).toISOString(),
      },
      delegation: [],
      grants: [],
    },
  };

  // If middleware has already attached auth info, use it; otherwise anonymous.
  const existingAuth = honoCtx.get("capstanAuth") as
    | CapstanAuthContext
    | undefined;

  const currentRequestId = honoCtx.get("capstanRequestId") as string | undefined;
  const currentTraceId = honoCtx.get("capstanTraceId") as string | undefined;
  const requestHeaderId = honoCtx.req.header("x-request-id");
  const traceHeaderId = honoCtx.req.header("x-trace-id");
  const requestIdentity = createRequestIdentity({
    ...(currentRequestId ? { requestId: currentRequestId } : {}),
    ...(currentTraceId ? { traceId: currentTraceId } : {}),
    ...(requestHeaderId ? { requestHeaderId } : {}),
    ...(traceHeaderId ? { traceHeaderId } : {}),
  });

  const ops = honoCtx.get("capstanOps") as CapstanContext["ops"] | undefined;

  return {
    auth: existingAuth ?? anonymousAuth,
    request: honoCtx.req.raw,
    env: (
      typeof process !== "undefined" && process.env
        ? process.env
        : {}
    ) as Record<string, string | undefined>,
    honoCtx,
    requestId: requestIdentity.requestId,
    traceId: requestIdentity.traceId,
    ...(ops ? { ops } : {}),
  };
}
