import type { Hono, Context as HonoContext } from "hono";
import { createContext } from "./context.js";
import {
  getApproval,
  listApprovals,
  resolveApproval,
} from "./approval.js";
import type { CapstanContext } from "./types.js";

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
 * Mount the approval management endpoints on a Hono app.
 *
 * These routes allow agents and humans to list, approve, and deny pending
 * approvals created by policy enforcement.  The `handlerRegistry` is used
 * by the "approve" endpoint to re-execute the original handler once an
 * approval has been granted.
 *
 * Both `createCapstanApp` (production) and the dev server call this
 * function so the logic lives in one place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountApprovalRoutes(app: Hono<any>, handlerRegistry: HandlerRegistry): void {
  /** List all approvals, optionally filtered by ?status=pending|approved|denied */
  app.get("/capstan/approvals", (c: HonoContext) => {
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
    const id = c.req.param("id")!;
    const approval = getApproval(id);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }
    return c.json(approval);
  });

  /** Approve a pending approval -- re-executes the original handler */
  app.post("/capstan/approvals/:id/approve", async (c: HonoContext) => {
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
