import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import {
  clearApprovals,
  clearAuditLog,
  createApproval,
  createContext,
  getAuditLog,
  mountApprovalRoutes,
  recordAuditEntry,
} from "@zauso-ai/capstan-core";
import type { HandlerRegistry } from "@zauso-ai/capstan-core";
import {
  authorizeGrant,
  checkPermission,
  createDelegationLink,
  createGrant,
  grantApprovalActions,
  grantRunActions,
  serializeGrantsToPermissions,
} from "@zauso-ai/capstan-auth";

function makeRichAuth(approvalId = "approval-1") {
  const runGrants = grantRunActions("run-1");
  const approvalGrants = grantApprovalActions(["manage"], { approvalId });
  const auditGrant = createGrant("audit", "read");
  const grants = [...runGrants, ...approvalGrants, auditGrant];

  return {
    isAuthenticated: true,
    type: "human" as const,
    userId: "user-1",
    role: "admin",
    email: "ada@example.com",
    permissions: serializeGrantsToPermissions(grants),
    actor: {
      kind: "user" as const,
      id: "user-1",
      displayName: "Ada Lovelace",
      role: "admin",
      email: "ada@example.com",
      claims: { department: "operations" },
    },
    credential: {
      kind: "session" as const,
      subjectId: "user-1",
      presentedAt: "2026-04-04T00:00:00.000Z",
      expiresAt: "2026-04-05T00:00:00.000Z",
      metadata: { sessionId: "sess-1" },
    },
    execution: {
      kind: "run" as const,
      id: "run:run-1",
      parentId: "request:GET /",
      metadata: { runId: "run-1" },
    },
    delegation: [
      createDelegationLink(
        { kind: "user", id: "user-1" } as any,
        { kind: "run", id: "run:run-1" } as any,
        "operator supervision",
        { approvalId },
      ),
    ],
    grants,
    envelope: {
      actor: {
        kind: "user" as const,
        id: "user-1",
        displayName: "Ada Lovelace",
        role: "admin",
        email: "ada@example.com",
        claims: { department: "operations" },
      },
      credential: {
        kind: "session" as const,
        subjectId: "user-1",
        presentedAt: "2026-04-04T00:00:00.000Z",
        expiresAt: "2026-04-05T00:00:00.000Z",
        metadata: { sessionId: "sess-1" },
      },
      execution: {
        kind: "run" as const,
        id: "run:run-1",
        parentId: "request:GET /",
        metadata: { runId: "run-1" },
      },
      delegation: [
        {
          from: { kind: "user", id: "user-1" },
          to: { kind: "run", id: "run:run-1" },
          reason: "operator supervision",
          issuedAt: "2026-04-04T00:00:00.000Z",
          metadata: { approvalId },
        },
      ],
      grants,
    },
  } as const;
}

describe("auth compatibility", () => {
  beforeEach(async () => {
    await clearApprovals();
    await clearAuditLog();
  });

  it("accepts both structured grants and legacy permission projections", () => {
    const grants = grantRunActions("run-1");

    expect(checkPermission({ resource: "run", action: "read" }, grants)).toBe(true);
    expect(
      authorizeGrant({ resource: "run", action: "resume", scope: { runId: "run-1" } }, grants)
        .allowed,
    ).toBe(true);
    expect(
      authorizeGrant({ resource: "run", action: "resume", scope: { runId: "run-2" } }, grants)
        .allowed,
    ).toBe(false);

    const permissions = serializeGrantsToPermissions(grants);
    expect(permissions).toContain("run:resume");
    expect(
      authorizeGrant({ resource: "run", action: "resume" }, permissions).allowed,
    ).toBe(true);
  });

  it("preserves rich auth shapes through createContext and audit persistence", async () => {
    const app = new Hono();
    let capturedAuth: unknown;

    app.use("*", async (c, next) => {
      c.set("capstanAuth", makeRichAuth() as any);
      await next();
    });

    app.get("/ctx", (c) => {
      const ctx = createContext(c);
      capturedAuth = ctx.auth;
      return c.json({ ok: true });
    });

    await app.fetch(new Request("http://localhost/ctx"));

    expect(capturedAuth).toMatchObject({
      isAuthenticated: true,
      type: "human",
      userId: "user-1",
      role: "admin",
      permissions: expect.arrayContaining(["approval:manage", "audit:read"]),
      actor: {
        kind: "user",
        id: "user-1",
        displayName: "Ada Lovelace",
      },
      envelope: {
        execution: {
          kind: "run",
          id: "run:run-1",
        },
      },
    });

    const richAuth = makeRichAuth();
    await recordAuditEntry({
      timestamp: "2026-04-04T12:00:00.000Z",
      requestId: "audit-1",
      method: "GET",
      path: "/capstan/audit",
      riskLevel: "minimal",
      auth: {
        type: richAuth.type,
        userId: richAuth.userId,
        actor: richAuth.actor,
        grants: richAuth.grants.map((grant) => ({
          resource: grant.resource,
          action: grant.action,
          scope: grant.scope,
        })),
      },
      input: { since: "2026-04-04T00:00:00.000Z" },
      output: { ok: true },
      durationMs: 2,
    });

    const [entry] = await getAuditLog();
    expect(entry).toMatchObject({
      requestId: "audit-1",
      auth: {
        type: "human",
        userId: "user-1",
        actor: {
          kind: "user",
          id: "user-1",
          displayName: "Ada Lovelace",
        },
        grants: expect.arrayContaining([
          expect.objectContaining({ resource: "run", action: "read" }),
          expect.objectContaining({ resource: "approval", action: "manage" }),
          expect.objectContaining({ resource: "audit", action: "read" }),
        ]),
      },
    });
  });

  it("keeps approval routes working when grants are projected to legacy permissions", async () => {
    const approval = await createApproval({
      method: "POST",
      path: "/api/items",
      input: { name: "widget" },
      policy: "requireApproval",
      reason: "Needs human review",
    });

    const richAuth = makeRichAuth(approval.id);
    const projectedApprovalPermissions = serializeGrantsToPermissions(
      grantApprovalActions(["manage"], { approvalId: approval.id }),
    );
    const legacyCompatibleAuth = {
      ...richAuth,
      grants: undefined,
      envelope: undefined,
      permissions: [...richAuth.permissions, ...projectedApprovalPermissions],
    };

    const handlerRegistry: HandlerRegistry = new Map();
    handlerRegistry.set("POST /api/items", async (input, ctx) => ({
      echoedInput: input,
      actorId: ctx.auth.actor.id,
      permissions: ctx.auth.permissions,
    }));

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("capstanAuth", legacyCompatibleAuth as any);
      await next();
    });
    mountApprovalRoutes(app, handlerRegistry);

    const res = await app.request(`/capstan/approvals/${approval.id}/approve`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      approvalId: string;
      result?: {
        actorId?: string;
        permissions?: string[];
        echoedInput?: unknown;
      };
    };

    expect(body.status).toBe("approved");
    expect(body.approvalId).toBe(approval.id);
    expect(body.result).toMatchObject({
      actorId: "user-1",
      echoedInput: { name: "widget" },
    });
    expect(body.result?.permissions).toEqual(
      expect.arrayContaining(["approval:manage", "audit:read"]),
    );
  });
});
