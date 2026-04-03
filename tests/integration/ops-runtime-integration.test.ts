import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  createApproval,
  createCapstanOpsContext,
  defineAPI,
  definePolicy,
  resolveApproval,
  clearApprovals,
} from "@zauso-ai/capstan-core";
import type {
  CapstanAuthContext,
  CapstanContext,
} from "@zauso-ai/capstan-core";
import type { RouteEntry, RouteManifest } from "@zauso-ai/capstan-router/runtime";
import { buildPortableRuntimeApp } from "../../packages/dev/src/runtime.ts";

function buildAnonymousAuth(): CapstanAuthContext {
  return {
    isAuthenticated: false,
    type: "anonymous",
    permissions: [],
    grants: [],
    delegation: [],
    actor: {
      kind: "anonymous",
      id: "anonymous",
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
}

function buildApprovalContext(
  ops = createCapstanOpsContext({ appName: "ops-runtime-test" })!,
): CapstanContext {
  return {
    auth: buildAnonymousAuth(),
    request: new Request("http://localhost/internal"),
    env: {},
    honoCtx: {} as never,
    requestId: "runtime-approval-request",
    traceId: "runtime-approval-trace",
    ops,
  };
}

function buildRoute(filePath: string, urlPattern: string): RouteEntry {
  return {
    filePath,
    type: "api",
    urlPattern,
    layouts: [],
    middlewares: [],
    params: [],
    isCatchAll: false,
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ops runtime integration", () => {
  afterEach(async () => {
    await clearApprovals();
  });

  it("emits runtime ops signals from portable API requests and approval flows", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const ops = createCapstanOpsContext({
        appName: "ops-runtime-test",
        source: "integration-test",
        recentWindowMs: 60_000,
      })!;
      const rootDir = "/workspace/ops-runtime-test";
      const echoFile = `${rootDir}/app/routes/api/echo.api.ts`;
      const approvalFile = `${rootDir}/app/routes/api/approval.api.ts`;
      const blockedFile = `${rootDir}/app/routes/api/blocked.api.ts`;

      const manifest: RouteManifest = {
        rootDir,
        scannedAt: new Date("2026-04-04T00:00:00.000Z").toISOString(),
        routes: [
          buildRoute("app/routes/api/echo.api.ts", "/api/echo"),
          buildRoute("app/routes/api/approval.api.ts", "/api/approval"),
          buildRoute("app/routes/api/blocked.api.ts", "/api/blocked"),
        ],
      };

      const routeModules: Record<string, Record<string, unknown>> = {
        [echoFile]: {
          GET: defineAPI({
            description: "Echo route",
            capability: "read",
            resource: "runtime.echo",
            async handler({ ctx, input }) {
              return {
                ok: true,
                requestId: ctx.requestId,
                traceId: ctx.traceId,
                input,
              };
            },
          }),
        },
        [approvalFile]: {
          POST: defineAPI({
            description: "Approval route",
            capability: "write",
            resource: "runtime.approval",
            policy: "needs-approval",
            async handler() {
              return { ok: true };
            },
          }),
        },
        [blockedFile]: {
          GET: defineAPI({
            description: "Blocked route",
            capability: "read",
            resource: "runtime.blocked",
            policy: "blocked",
            async handler() {
              return { ok: true };
            },
          }),
        },
      };

      const blockedPolicy = definePolicy({
        key: "blocked",
        title: "Blocked",
        effect: "deny",
        async check() {
          return { effect: "deny", reason: "blocked at runtime" };
        },
      });

      const build = await buildPortableRuntimeApp({
        appName: "ops-runtime-test",
        rootDir,
        manifest,
        routeModules,
        mode: "development",
        ops: {
          appName: "ops-runtime-test",
          source: "integration-test",
          recentWindowMs: 60_000,
          runtime: ops.runtime,
          store: ops.store,
        },
        policyRegistry: new Map([[blockedPolicy.key, blockedPolicy]]),
      });

      expect(build.apiRouteCount).toBe(3);
      await settle();

      const allowedResponse = await build.app.fetch(
        new Request("http://localhost/api/echo?value=hello", {
          headers: {
            "X-Request-Id": "runtime-request-allowed",
            "X-Trace-Id": "runtime-trace-allowed",
          },
        }),
      );

      expect(allowedResponse.status).toBe(200);
      expect(allowedResponse.headers.get("X-Request-Id")).toBe(
        "runtime-request-allowed",
      );
      expect(allowedResponse.headers.get("X-Trace-Id")).toBe(
        "runtime-trace-allowed",
      );
      const allowedBody = (await allowedResponse.json()) as {
        ok: boolean;
        requestId: string;
        traceId: string;
        input: Record<string, string>;
      };
      expect(allowedBody.ok).toBe(true);
      expect(allowedBody.requestId).toBe("runtime-request-allowed");
      expect(allowedBody.traceId).toBe("runtime-trace-allowed");
      expect(allowedBody.input.value).toBe("hello");

      const allowedRequests = await ops.queryEvents({
        kinds: ["request"],
        requestId: "runtime-request-allowed",
      });
      expect(allowedRequests.map((event) => event.phase)).toEqual(["start", "end"]);

      const allowedCapabilities = await ops.queryEvents({
        kinds: ["capability"],
        requestId: "runtime-request-allowed",
      });
      expect(allowedCapabilities).toHaveLength(2);
      expect(allowedCapabilities[1]?.data?.outcome).toBe("success");

      const approvalResponse = await build.app.fetch(
        new Request("http://localhost/api/approval", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": "runtime-request-approval",
            "X-Trace-Id": "runtime-trace-approval",
          },
          body: JSON.stringify({ reason: "manual review" }),
        }),
      );

      expect(approvalResponse.status).toBe(202);
      const approvalBody = (await approvalResponse.json()) as {
        status: string;
        approvalId: string;
        reason: string;
      };
      expect(approvalBody.status).toBe("approval_required");
      expect(approvalBody.reason).toContain("approval");

      const approvalEvents = await ops.queryEvents({
        kinds: ["approval"],
        requestId: "runtime-request-approval",
      });
      expect(approvalEvents).toHaveLength(1);
      expect(approvalEvents[0]?.phase).toBe("requested");

      const directApproval = await createApproval({
        method: "POST",
        path: "/api/direct-approval",
        input: { reason: "manual" },
        policy: "manual-review",
        reason: "manual review requested",
        ctx: buildApprovalContext(ops),
      });

      await resolveApproval(
        directApproval.id,
        "approved",
        "runtime-reviewer",
        buildApprovalContext(ops),
      );

      const resolvedApprovalEvents = await ops.queryEvents({
        kinds: ["approval"],
        requestId: "runtime-approval-request",
      });
      expect(resolvedApprovalEvents.map((event) => event.phase)).toEqual([
        "requested",
        "resolved",
      ]);

      const deniedResponse = await build.app.fetch(
        new Request("http://localhost/api/blocked", {
          headers: {
            "X-Request-Id": "runtime-request-denied",
            "X-Trace-Id": "runtime-trace-denied",
          },
        }),
      );

      expect(deniedResponse.status).toBe(403);

      const policyEvents = await ops.queryEvents({
        kinds: ["policy"],
        requestId: "runtime-request-denied",
      });
      expect(policyEvents).toHaveLength(1);
      expect(policyEvents[0]?.data?.effect).toBe("deny");
      expect(policyEvents[0]?.incidentFingerprint).toContain("policy:blocked:deny");

      const healthEvents = await ops.queryEvents({ kinds: ["health"] });
      expect(healthEvents.length).toBeGreaterThan(0);

      const incidents = await ops.queryIncidents();
      expect(
        incidents.some((incident) => incident.fingerprint === "policy:blocked:deny"),
      ).toBe(true);

      expect(build.diagnostics.length).toBeGreaterThanOrEqual(0);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
