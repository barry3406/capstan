import { describe, it, expect } from "bun:test";
import {
  createDelegationLink,
  createRequestExecution,
  createGrant,
  normalizePermissionsToGrants,
  serializeGrantsToPermissions,
  signSession,
  verifySession,
} from "@zauso-ai/capstan-auth";
import type {
  ActorIdentity,
  AuthContext,
  AuthEnvelope,
  CredentialProof,
  ExecutionIdentity,
} from "@zauso-ai/capstan-auth";

const SECRET = "auth-envelope-test-secret";

describe("auth envelope", () => {
  it("supports a full actor / credential / execution / delegation / grants envelope", () => {
    const actor: ActorIdentity = {
      kind: "user",
      id: "user-123",
      displayName: "Ada",
      role: "admin",
      email: "ada@example.com",
      claims: { team: "platform" },
    };
    const credential: CredentialProof = {
      kind: "session",
      subjectId: actor.id,
      presentedAt: "2025-04-01T00:00:00.000Z",
      metadata: { sessionId: "sess-123" },
    };
    const execution: ExecutionIdentity = createRequestExecution(
      new Request("https://capstan.example/api/tickets?tab=open", { method: "POST" }),
    );
    const grants = normalizePermissionsToGrants([
      "ticket:read",
      createGrant("run", "resume", { scope: { runId: "run-1" } }),
      createGrant("approval", "approve", {
        scope: { approvalId: "approval-9", runId: "run-1" },
      }),
    ]);
    const delegation = [
      createDelegationLink(actor, execution, "human initiated request"),
    ];

    const envelope: AuthEnvelope = {
      actor,
      credential,
      execution,
      delegation,
      grants,
    };

    const auth: AuthContext = {
      isAuthenticated: true,
      type: "human",
      actor,
      credential,
      execution,
      delegation,
      grants,
      userId: actor.id,
      role: actor.role,
      email: actor.email,
      permissions: serializeGrantsToPermissions(grants),
      envelope,
    };

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.actor.kind).toBe("user");
    expect(auth.actor.displayName).toBe("Ada");
    expect(auth.credential.kind).toBe("session");
    expect(auth.execution?.kind).toBe("request");
    expect(auth.execution?.metadata).toMatchObject({
      method: "POST",
      pathname: "/api/tickets",
      origin: "https://capstan.example",
    });
    expect(auth.delegation).toHaveLength(1);
    expect(auth.grants).toHaveLength(3);
    expect(auth.permissions).toEqual([
      "ticket:read",
      "run:resume",
      "approval:approve",
    ]);
    expect(auth.envelope?.actor.id).toBe("user-123");
    expect(auth.envelope?.credential.metadata).toEqual({ sessionId: "sess-123" });
  });

  it("keeps the envelope JSON-safe for SSR and audit snapshots", () => {
    const actor: ActorIdentity = {
      kind: "agent",
      id: "agent-1",
      displayName: "Planner",
    };
    const credential: CredentialProof = {
      kind: "api_key",
      subjectId: actor.id,
      presentedAt: "2025-04-01T00:00:00.000Z",
    };
    const envelope: AuthEnvelope = {
      actor,
      credential,
      execution: {
        kind: "run",
        id: "run:run-1",
        parentId: "request:POST /runs",
        metadata: { runId: "run-1" },
      },
      delegation: [createDelegationLink(actor, { kind: "run", id: "run:run-1" }, "delegated")],
      grants: normalizePermissionsToGrants(["run:view", "artifact:read"]),
    };

    const serialized = JSON.stringify(envelope);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(parsed.actor).toMatchObject({ kind: "agent", id: "agent-1" });
    expect(parsed.credential).toMatchObject({ kind: "api_key", subjectId: "agent-1" });
    expect(parsed.execution).toMatchObject({ kind: "run", id: "run:run-1" });
    expect(parsed.grants).toHaveLength(2);
  });

  it("supports issuer and audience checks for sessions", () => {
    const token = signSession(
      {
        userId: "user-1",
        email: "user@example.com",
        role: "admin",
        displayName: "User One",
        permissions: ["audit:read"],
        claims: { tenant: "blue" },
        sessionId: "sess-001",
      },
      SECRET,
      {
        maxAge: "1h",
        issuer: "capstan",
        audience: "capstan-web",
      },
    );

    const verified = verifySession(token, SECRET, {
      issuer: "capstan",
      audience: "capstan-web",
    });

    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe("user-1");
    expect(verified?.displayName).toBe("User One");
    expect(verified?.permissions).toEqual(["audit:read"]);
    expect(verified?.claims).toEqual({ tenant: "blue" });
    expect(verified?.sessionId).toBe("sess-001");
    expect(verified?.iss).toBe("capstan");
    expect(verified?.aud).toBe("capstan-web");
  });

  it("rejects sessions when issuer or audience do not match", () => {
    const token = signSession(
      { userId: "user-1" },
      SECRET,
      {
        maxAge: "1h",
        issuer: "capstan",
        audience: "capstan-web",
      },
    );

    expect(
      verifySession(token, SECRET, {
        issuer: "other",
        audience: "capstan-web",
      }),
    ).toBeNull();
    expect(
      verifySession(token, SECRET, {
        issuer: "capstan",
        audience: "other",
      }),
    ).toBeNull();
  });
});
