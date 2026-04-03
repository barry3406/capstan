import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  PageContext,
  useAuth,
  useLoaderData,
} from "@zauso-ai/capstan-react";
import type { CapstanPageContext } from "@zauso-ai/capstan-react";
import {
  NavigationProvider,
  useRouterState,
} from "@zauso-ai/capstan-react/client";
import {
  createDelegationLink,
  createGrant,
  createRequestExecution,
  grantArtifactActions,
  grantRunActions,
  serializeGrantsToPermissions,
} from "@zauso-ai/capstan-auth";

function makeRichAuth() {
  const grants = [
    ...grantRunActions("run-1"),
    ...grantArtifactActions("run-1", ["read"], "artifact-1"),
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
    },
    execution: createRequestExecution(new Request("http://localhost/ops")),
    delegation: [
      createDelegationLink(
        { kind: "user", id: "user-1" } as any,
        { kind: "request", id: "GET /ops" } as any,
        "initial render",
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
      },
      execution: createRequestExecution(new Request("http://localhost/ops")),
      delegation: [
        {
          from: { kind: "user", id: "user-1" },
          to: { kind: "request", id: "GET /ops" },
          reason: "initial render",
          issuedAt: "2026-04-04T12:00:00.000Z",
        },
      ],
      grants,
    },
  } as const;
}

describe("React auth context compatibility", () => {
  it("preserves a rich auth envelope through PageContext and useAuth", () => {
    const auth = makeRichAuth();
    const pageContext: CapstanPageContext = {
      loaderData: { workspace: "ops" },
      params: { id: "ops-1" },
      auth: auth as any,
    };

    function Reader() {
      const ctxAuth = useAuth() as any;
      const loaderData = useLoaderData<{ workspace: string }>();
      return createElement(
        "pre",
        null,
        JSON.stringify(
          {
            actorName: ctxAuth.actor.displayName,
            actorKind: ctxAuth.actor.kind,
            executionId: ctxAuth.execution.id,
            permissions: ctxAuth.permissions,
            workspace: loaderData.workspace,
          },
          null,
          2,
        ),
      );
    }

    const html = renderToString(
      createElement(PageContext.Provider, { value: pageContext }, createElement(Reader)),
    );

    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("executionId");
    expect(html).toContain("workspace");
    expect(html).toContain("artifact:read");
  });

  it("keeps rich auth stable through NavigationProvider's initial client context", () => {
    const auth = makeRichAuth();

    function Reader() {
      const ctxAuth = useAuth() as any;
      const routerState = useRouterState();
      return createElement(
        "div",
        null,
        `${ctxAuth.actor.kind}:${ctxAuth.execution.kind}:${ctxAuth.grants.length}:${routerState.status}`,
      );
    }

    const html = renderToString(
      createElement(
        NavigationProvider,
        {
          initialLoaderData: { route: "dashboard" },
          initialParams: { id: "dashboard" },
          initialAuth: auth as any,
        },
        createElement(Reader),
      ),
    );

    expect(html).toContain("user:request");
    expect(html).toContain(String(auth.grants.length));
    expect(html).toContain("idle");
  });
});
