import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import {
  createApproval,
  getApproval,
  listApprovals,
  resolveApproval,
  clearApprovals,
  mountApprovalRoutes,
} from "@zauso-ai/capstan-core";
import type { HandlerRegistry, PendingApproval } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestApp(authOverride?: {
  isAuthenticated?: boolean;
  role?: string;
  permissions?: string[];
}) {
  const app = new Hono();
  const handlerRegistry: HandlerRegistry = new Map();

  // Middleware that sets capstanAuth on the Hono context.
  app.use("*", async (c, next) => {
    const auth = authOverride ?? {
      isAuthenticated: true,
      role: "admin",
      permissions: ["approval:manage"],
    };
    c.set("capstanAuth", auth);
    await next();
  });

  mountApprovalRoutes(app, handlerRegistry);
  return { app, handlerRegistry };
}

async function seedApproval(overrides?: Partial<Parameters<typeof createApproval>[0]>): Promise<PendingApproval> {
  return createApproval({
    method: "POST",
    path: "/api/items",
    input: { name: "test" },
    policy: "requireApproval",
    reason: "High-risk operation",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// approval.ts — pure store functions
// ---------------------------------------------------------------------------

describe("approval store", () => {
  beforeEach(async () => {
    await clearApprovals();
  });

  it("createApproval creates a pending approval with correct fields", async () => {
    const approval = await createApproval({
      method: "POST",
      path: "/api/items",
      input: { name: "widget" },
      policy: "requireApproval",
      reason: "Needs human review",
    });

    expect(approval.id).toBeDefined();
    expect(approval.method).toBe("POST");
    expect(approval.path).toBe("/api/items");
    expect(approval.input).toEqual({ name: "widget" });
    expect(approval.policy).toBe("requireApproval");
    expect(approval.reason).toBe("Needs human review");
    expect(approval.status).toBe("pending");
    expect(approval.createdAt).toBeDefined();
    expect(approval.resolvedAt).toBeUndefined();
    expect(approval.resolvedBy).toBeUndefined();
  });

  it("getApproval retrieves a stored approval by ID", async () => {
    const created = await seedApproval();
    const fetched = await getApproval(created.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.status).toBe("pending");
  });

  it("getApproval returns undefined for unknown ID", async () => {
    const fetched = await getApproval("nonexistent-id");
    expect(fetched).toBeUndefined();
  });

  it("listApprovals returns all approvals", async () => {
    await seedApproval({ path: "/api/a" });
    await seedApproval({ path: "/api/b" });

    const all = await listApprovals();
    expect(all.length).toBe(2);
  });

  it("listApprovals filters by status", async () => {
    const a = await seedApproval({ path: "/api/a" });
    await seedApproval({ path: "/api/b" });

    await resolveApproval(a.id, "approved");

    const pending = await listApprovals("pending");
    expect(pending.length).toBe(1);
    expect(pending[0]!.path).toBe("/api/b");

    const approved = await listApprovals("approved");
    expect(approved.length).toBe(1);
    expect(approved[0]!.id).toBe(a.id);
  });

  it("resolveApproval changes status to approved", async () => {
    const created = await seedApproval();
    const resolved = await resolveApproval(created.id, "approved", "admin@example.com");

    expect(resolved).toBeDefined();
    expect(resolved!.status).toBe("approved");
    expect(resolved!.resolvedAt).toBeDefined();
    expect(resolved!.resolvedBy).toBe("admin@example.com");
  });

  it("resolveApproval changes status to denied", async () => {
    const created = await seedApproval();
    const resolved = await resolveApproval(created.id, "denied");

    expect(resolved).toBeDefined();
    expect(resolved!.status).toBe("denied");
    expect(resolved!.resolvedAt).toBeDefined();
  });

  it("resolveApproval returns undefined for unknown ID", async () => {
    const result = await resolveApproval("nonexistent", "approved");
    expect(result).toBeUndefined();
  });

  it("clearApprovals removes all approvals", async () => {
    await seedApproval({ path: "/api/a" });
    await seedApproval({ path: "/api/b" });
    await seedApproval({ path: "/api/c" });

    let all = await listApprovals();
    expect(all.length).toBe(3);

    await clearApprovals();

    all = await listApprovals();
    expect(all.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// approval-routes.ts — HTTP route handlers
// ---------------------------------------------------------------------------

describe("approval routes", () => {
  beforeEach(async () => {
    await clearApprovals();
  });

  // -----------------------------------------------------------------------
  // Authentication & authorization
  // -----------------------------------------------------------------------

  it("returns 401 when not authenticated", async () => {
    const { app } = createTestApp({ isAuthenticated: false });
    const res = await app.request("/capstan/approvals");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authentication");
  });

  it("returns 403 without approval:manage permission", async () => {
    const { app } = createTestApp({
      isAuthenticated: true,
      role: "user",
      permissions: [],
    });
    const res = await app.request("/capstan/approvals");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("approval:manage");
  });

  it("allows admin role even without explicit permission", async () => {
    const { app } = createTestApp({
      isAuthenticated: true,
      role: "admin",
      permissions: [],
    });

    await seedApproval();
    const res = await app.request("/capstan/approvals");

    expect(res.status).toBe(200);
  });

  // -----------------------------------------------------------------------
  // GET /capstan/approvals
  // -----------------------------------------------------------------------

  it("GET /capstan/approvals returns list of pending approvals", async () => {
    const { app } = createTestApp();
    await seedApproval({ path: "/api/items" });
    await seedApproval({ path: "/api/orders" });

    const res = await app.request("/capstan/approvals");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.approvals).toBeDefined();
    expect(body.approvals.length).toBe(2);
  });

  it("GET /capstan/approvals returns empty list when no approvals exist", async () => {
    const { app } = createTestApp();

    const res = await app.request("/capstan/approvals");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.approvals).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // GET /capstan/approvals/:id
  // -----------------------------------------------------------------------

  it("GET /capstan/approvals/:id returns specific approval", async () => {
    const { app } = createTestApp();
    const approval = await seedApproval();

    const res = await app.request(`/capstan/approvals/${approval.id}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(approval.id);
    expect(body.status).toBe("pending");
  });

  it("GET /capstan/approvals/:id returns 404 for unknown ID", async () => {
    const { app } = createTestApp();

    const res = await app.request("/capstan/approvals/nonexistent-id");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("not found");
  });

  // -----------------------------------------------------------------------
  // POST /capstan/approvals/:id/approve
  // -----------------------------------------------------------------------

  it("POST /capstan/approvals/:id/approve resolves the approval", async () => {
    const { app, handlerRegistry } = createTestApp();
    const approval = await seedApproval();

    // Register a handler so the approve route can re-execute it.
    handlerRegistry.set("POST /api/items", async (input) => {
      return { created: true, input };
    });

    const res = await app.request(`/capstan/approvals/${approval.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "admin@test.com" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("approved");
    expect(body.approvalId).toBe(approval.id);
    expect(body.result).toBeDefined();
  });

  it("POST /capstan/approvals/:id/approve replays stored params for dynamic routes", async () => {
    const { app, handlerRegistry } = createTestApp();
    const approval = await seedApproval({
      path: "/api/items/:id",
      params: { id: "42" },
    });

    handlerRegistry.set("POST /api/items/:id", async (input, ctx, params) => {
      return {
        input,
        params,
        actorType: ctx.auth.type,
      };
    });

    const res = await app.request(`/capstan/approvals/${approval.id}/approve`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      status: string;
      approvalId: string;
      result?: {
        params?: Record<string, string>;
        input?: unknown;
      };
    };

    expect(body.status).toBe("approved");
    expect(body.result).toMatchObject({
      params: { id: "42" },
      input: { name: "test" },
    });
  });

  it("POST /capstan/approvals/:id/approve returns 409 if already resolved", async () => {
    const { app, handlerRegistry } = createTestApp();
    const approval = await seedApproval();

    handlerRegistry.set("POST /api/items", async () => ({ ok: true }));

    // Approve first time
    await resolveApproval(approval.id, "approved");

    // Try to approve again via route
    const res = await app.request(`/capstan/approvals/${approval.id}/approve`, {
      method: "POST",
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("already resolved");
  });

  it("POST /capstan/approvals/:id/approve returns 404 for unknown ID", async () => {
    const { app } = createTestApp();

    const res = await app.request("/capstan/approvals/nonexistent/approve", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  // -----------------------------------------------------------------------
  // POST /capstan/approvals/:id/deny
  // -----------------------------------------------------------------------

  it("POST /capstan/approvals/:id/deny resolves with denied status", async () => {
    const { app } = createTestApp();
    const approval = await seedApproval();

    const res = await app.request(`/capstan/approvals/${approval.id}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "admin@test.com", reason: "Not needed" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("denied");
    expect(body.approvalId).toBe(approval.id);
  });

  it("POST /capstan/approvals/:id/deny returns 409 if already resolved", async () => {
    const { app } = createTestApp();
    const approval = await seedApproval();

    await resolveApproval(approval.id, "denied");

    const res = await app.request(`/capstan/approvals/${approval.id}/deny`, {
      method: "POST",
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("already resolved");
  });

  it("POST /capstan/approvals/:id/deny returns 404 for unknown ID", async () => {
    const { app } = createTestApp();

    const res = await app.request("/capstan/approvals/nonexistent/deny", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
