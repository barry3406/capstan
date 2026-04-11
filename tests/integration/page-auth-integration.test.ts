import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import { runPageRuntime } from "@zauso-ai/capstan-dev";
import type { LoaderArgs, PageModule } from "@zauso-ai/capstan-react";
import {
  createDelegationLink,
  createExecutionIdentity,
  createGrant,
  grantApprovalActions,
  grantArtifactActions,
  grantRunActions,
  serializeGrantsToPermissions,
} from "@zauso-ai/capstan-auth";

function makeRichAuth() {
  const grants = [
    ...grantRunActions("run-1"),
    ...grantArtifactActions("run-1", ["read"], "artifact-1"),
    ...grantApprovalActions(["manage"], { approvalId: "approval-1" }),
    createGrant("audit", "read"),
  ];

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
    },
    credential: {
      kind: "session" as const,
      subjectId: "user-1",
      presentedAt: "2026-04-04T12:00:00.000Z",
      expiresAt: "2026-04-05T12:00:00.000Z",
    },
    execution: createExecutionIdentity("run", "run-1", {
      parentId: "request:GET /workspace",
      metadata: { runId: "run-1" },
    }),
    delegation: [
      createDelegationLink(
        { kind: "user", id: "user-1" } as any,
        { kind: "run", id: "run:run-1" } as any,
        "initial operator supervision",
        { approvalId: "approval-1" },
      ),
    ],
    grants,
    envelope: {
      actor: {
        kind: "user" as const,
        id: "user-1",
        displayName: "Ada Lovelace",
      },
      credential: {
        kind: "session" as const,
        subjectId: "user-1",
        presentedAt: "2026-04-04T12:00:00.000Z",
        expiresAt: "2026-04-05T12:00:00.000Z",
      },
      execution: createExecutionIdentity("run", "run-1", {
        parentId: "request:GET /workspace",
        metadata: { runId: "run-1" },
      }),
      delegation: [
        {
          from: { kind: "user", id: "user-1" },
          to: { kind: "run", id: "run:run-1" },
          reason: "initial operator supervision",
          issuedAt: "2026-04-04T12:00:00.000Z",
          metadata: { approvalId: "approval-1" },
        },
      ],
      grants,
    },
  } as const;
}

function makeLoaderArgs(auth: unknown, request: Request): LoaderArgs {
  return {
    params: { workspaceId: "workspace-1" },
    request,
    ctx: { auth: auth as any },
    fetch: {
      get: async () => null,
      post: async () => null,
      put: async () => null,
      delete: async () => null,
    },
  };
}

const pageModule: PageModule = {
  default: () => createElement("main", null, "Auth Surface"),
  loader: async (args) => ({ auth: args.ctx.auth }),
  metadata: { title: "Auth Surface" },
};

describe("page auth integration", () => {
  it("propagates the same rich auth snapshot through document and navigation payloads", async () => {
    const auth = makeRichAuth();

    const documentRequest = new Request("http://localhost/workspace");
    const documentResult = await runPageRuntime({
      pageModule,
      layouts: [],
      params: { workspaceId: "workspace-1" },
      request: documentRequest,
      loaderArgs: makeLoaderArgs(auth, documentRequest),
    });

    expect(documentResult.kind).toBe("document");
    if (documentResult.kind !== "document") {
      throw new Error("Expected document result");
    }

    expect(documentResult.loaderData).toEqual({ auth });
    expect(documentResult.html).toContain("__CAPSTAN_DATA__");
    expect(documentResult.html).toContain("Ada Lovelace");
    expect(documentResult.html).toContain("approval:manage");

    const navigationRequest = new Request("http://localhost/workspace", {
      headers: { "X-Capstan-Nav": "1" },
    });
    const navigationResult = await runPageRuntime({
      pageModule,
      layouts: [],
      params: { workspaceId: "workspace-1" },
      request: navigationRequest,
      loaderArgs: makeLoaderArgs(auth, navigationRequest),
    });

    expect(navigationResult.kind).toBe("navigation");
    if (navigationResult.kind !== "navigation") {
      throw new Error("Expected navigation result");
    }

    expect(navigationResult.payload.loaderData).toEqual({ auth });
    expect(navigationResult.payload.auth).toEqual(auth);
    expect(navigationResult.payload.componentType).toBe("server");
    expect(navigationResult.payload.html).toContain("Auth Surface");
    expect(navigationResult.body).toContain("Ada Lovelace");
    expect(navigationResult.body).toContain("approval:manage");
  });
});
