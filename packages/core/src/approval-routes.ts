import type { Hono, Context as HonoContext } from "hono";
import { createContext } from "./context.js";
import {
  getApproval,
  listApprovals,
  resolveApproval,
} from "./approval.js";
import type { CapstanAuthContext, CapstanContext } from "./types.js";

/**
 * Handler registry type shared between the production and dev servers.
 * Maps "METHOD /path" keys to functions that re-execute a route handler
 * with the stored approval input.
 */
export type HandlerRegistry = Map<
  string,
  (input: unknown, ctx: CapstanContext) => Promise<unknown>
>;

/**
 * Check that the request is authenticated and has the "approval:manage"
 * permission (or "admin" role).  Returns a 401 response if the caller is
 * not authenticated, or a 403 response if the caller lacks the required
 * permission.  Returns `null` when the check passes.
 */
function requireApprovalAuth(c: HonoContext): Response | null {
  const auth = c.get("capstanAuth") as CapstanAuthContext | undefined;

  // Fail closed: if no auth context is present at all, deny the request.
  if (!auth || !auth.isAuthenticated) {
    return c.json(
      { error: "Authentication required to manage approvals" },
      401,
    );
  }

  // Allow admins and callers with the explicit "approval:manage" permission.
  const perms: string[] = auth.permissions ?? [];
  const isAdmin = auth.role === "admin";
  const hasPermission = perms.includes("approval:manage");

  if (!isAdmin && !hasPermission) {
    return c.json(
      { error: "Forbidden: approval:manage permission required" },
      403,
    );
  }

  return null;
}

/**
 * Mount the approval management endpoints on a Hono app.
 *
 * These routes allow agents and humans to list, approve, and deny pending
 * approvals created by policy enforcement.  The `handlerRegistry` is used
 * by the "approve" endpoint to re-execute the original handler once an
 * approval has been granted.
 *
 * All approval routes require authentication and either the "admin" role
 * or the "approval:manage" permission.
 *
 * Both `createCapstanApp` (production) and the dev server call this
 * function so the logic lives in one place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountApprovalRoutes(app: Hono<any>, handlerRegistry: HandlerRegistry): void {
  /** List all approvals, optionally filtered by ?status=pending|approved|denied */
  app.get("/capstan/approvals", (c: HonoContext) => {
    const authErr = requireApprovalAuth(c);
    if (authErr) return authErr;
    const statusParam = new URL(c.req.url).searchParams.get("status") as
      | "pending"
      | "approved"
      | "denied"
      | null;
    const items = listApprovals(statusParam ?? undefined);
    return c.json({ approvals: items });
  });

  /** Get a single approval by ID */
  app.get("/capstan/approvals/:id", (c: HonoContext) => {
    const authErr = requireApprovalAuth(c);
    if (authErr) return authErr;
    const id = c.req.param("id")!;
    const approval = getApproval(id);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }
    return c.json(approval);
  });

  /** Approve a pending approval -- re-executes the original handler */
  app.post("/capstan/approvals/:id/approve", async (c: HonoContext) => {
    const authErr = requireApprovalAuth(c);
    if (authErr) return authErr;
    const id = c.req.param("id")!;
    const existing = getApproval(id);
    if (!existing) {
      return c.json({ error: "Approval not found" }, 404);
    }
    if (existing.status !== "pending") {
      return c.json(
        { error: "Approval already resolved", status: existing.status },
        409,
      );
    }

    // Parse optional body for resolvedBy
    let resolvedBy: string | undefined;
    try {
      const body = await c.req.json() as Record<string, unknown>;
      if (typeof body.resolvedBy === "string") {
        resolvedBy = body.resolvedBy;
      }
    } catch {
      // No body or invalid JSON -- that's fine.
    }

    const approval = resolveApproval(id, "approved", resolvedBy);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }

    // Re-execute the original handler with the stored input.
    const routeKey = `${approval.method} ${approval.path}`;
    const handler = handlerRegistry.get(routeKey);
    if (!handler) {
      return c.json(
        { error: "Handler not found for route", route: routeKey },
        500,
      );
    }

    try {
      const ctx = createContext(c);
      const result = await handler(approval.input, ctx);
      approval.result = result;
      return c.json({
        status: "approved",
        approvalId: approval.id,
        result,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Handler execution failed";
      return c.json({ error: message, approvalId: approval.id }, 500);
    }
  });

  /** Deny a pending approval */
  app.post("/capstan/approvals/:id/deny", async (c: HonoContext) => {
    const authErr = requireApprovalAuth(c);
    if (authErr) return authErr;
    const id = c.req.param("id")!;
    const existing = getApproval(id);
    if (!existing) {
      return c.json({ error: "Approval not found" }, 404);
    }
    if (existing.status !== "pending") {
      return c.json(
        { error: "Approval already resolved", status: existing.status },
        409,
      );
    }

    let resolvedBy: string | undefined;
    let reason: string | undefined;
    try {
      const body = await c.req.json() as Record<string, unknown>;
      if (typeof body.resolvedBy === "string") {
        resolvedBy = body.resolvedBy;
      }
      if (typeof body.reason === "string") {
        reason = body.reason;
      }
    } catch {
      // No body or invalid JSON -- that's fine.
    }

    const approval = resolveApproval(id, "denied", resolvedBy);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }

    return c.json({
      status: "denied",
      approvalId: approval.id,
      ...(reason !== undefined ? { reason } : {}),
    });
  });
}
