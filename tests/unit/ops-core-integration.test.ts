import { afterEach, describe, expect, it } from "bun:test";
import {
  createApproval,
  createCapstanApp,
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
  ops = createCapstanOpsContext({ appName: "ops-core-test" })!,
): CapstanContext {
  return {
    auth: buildAnonymousAuth(),
    request: new Request("http://localhost/internal"),
    env: {},
    honoCtx: {} as never,
    requestId: "approval-request",
    traceId: "approval-trace",
    ops,
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ops core integration", () => {
  afterEach(async () => {
    await clearApprovals();
  });

  it("fans out normalized core events to configured ops sinks", async () => {
    const captured = [] as Array<{
      kind: string;
      phase: string;
      appName?: string;
      source?: string;
      requestId?: string;
      traceId?: string;
    }>;
    const ops = createCapstanOpsContext({
      appName: "ops-core-test",
      source: "unit-test",
      sink: {
        async recordEvent(event) {
          captured.push({
            kind: event.kind,
            phase: event.phase,
            appName: event.appName,
            source: event.source,
            requestId: event.requestId,
            traceId: event.traceId,
          });
        },
      },
    })!;

    await ops.recordRequestStart({
      requestId: "sink-request",
      traceId: "sink-trace",
      data: {
        method: "GET",
        path: "/ops/sink",
      },
    });
    await ops.recordRequestEnd({
      requestId: "sink-request",
      traceId: "sink-trace",
      data: {
        method: "GET",
        path: "/ops/sink",
        status: 200,
      },
    });
    await ops.recordHealthSnapshot({
      appName: "ops-core-test",
      mode: "development",
      now: "2026-04-04T00:00:05.000Z",
    });

    expect(captured.map((event) => `${event.kind}.${event.phase}`)).toEqual([
      "request.start",
      "request.end",
      "health.snapshot",
    ]);
    expect(captured.every((event) => event.appName === "ops-core-test")).toBe(true);
    expect(captured.every((event) => event.source === "unit-test")).toBe(true);
    expect(captured[0]?.requestId).toBe("sink-request");
    expect(captured[0]?.traceId).toBe("sink-trace");
  });

  it("threads request, capability, policy, approval, and health signals through the core app", async () => {
    const ops = createCapstanOpsContext({
      appName: "ops-core-test",
      source: "unit-test",
      recentWindowMs: 60_000,
    })!;

    const capstan = await createCapstanApp({
      app: { name: "ops-core-test" },
      ops: {
        appName: "ops-core-test",
        source: "unit-test",
        recentWindowMs: 60_000,
        runtime: ops.runtime,
        store: ops.store,
      },
    });

    const allowPolicy = definePolicy({
      key: "allow-all",
      title: "Allow All",
      effect: "allow",
      async check() {
        return { effect: "allow", reason: "allowed" };
      },
    });

    const approvePolicy = definePolicy({
      key: "needs-approval",
      title: "Needs Approval",
      effect: "approve",
      async check() {
        return { effect: "approve", reason: "requires human review" };
      },
    });

    const denyPolicy = definePolicy({
      key: "deny-all",
      title: "Deny All",
      effect: "deny",
      async check() {
        return { effect: "deny", reason: "blocked by policy" };
      },
    });

    capstan.registerAPI(
      "GET",
      "/ops/allowed",
      defineAPI({
        description: "Allowed route",
        capability: "read",
        resource: "ops.allowed",
        async handler({ ctx, input }) {
          return {
            ok: true,
            requestId: ctx.requestId,
            traceId: ctx.traceId,
            input,
          };
        },
      }),
      [allowPolicy],
    );

    capstan.registerAPI(
      "POST",
      "/ops/approval",
      defineAPI({
        description: "Approval route",
        capability: "write",
        resource: "ops.approval",
        async handler() {
          return { ok: true };
        },
      }),
      [approvePolicy],
    );

    capstan.registerAPI(
      "GET",
      "/ops/denied",
      defineAPI({
        description: "Denied route",
        capability: "read",
        resource: "ops.denied",
        async handler() {
          return { ok: true };
        },
      }),
      [denyPolicy],
    );

    await settle();

    const allowedResponse = await capstan.app.fetch(
      new Request("http://localhost/ops/allowed?value=1", {
        headers: {
          "X-Request-Id": "request-allowed",
          "X-Trace-Id": "trace-allowed",
        },
      }),
    );

    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.headers.get("X-Request-Id")).toBe("request-allowed");
    expect(allowedResponse.headers.get("X-Trace-Id")).toBe("trace-allowed");

    const allowedBody = (await allowedResponse.json()) as {
      ok: boolean;
      requestId: string;
      traceId: string;
      input: Record<string, string>;
    };
    expect(allowedBody.ok).toBe(true);
    expect(allowedBody.requestId).toBe("request-allowed");
    expect(allowedBody.traceId).toBe("trace-allowed");
    // Input coercion may convert "1" to number 1 for GET query params
    expect(String(allowedBody.input.value)).toBe("1");

    const allowedRequestEvents = await ops.queryEvents({
      kinds: ["request"],
      requestId: "request-allowed",
    });
    expect(allowedRequestEvents.map((event) => event.phase)).toEqual([
      "start",
      "end",
    ]);

    const allowedCapabilityEvents = await ops.queryEvents({
      kinds: ["capability"],
      requestId: "request-allowed",
    });
    expect(allowedCapabilityEvents).toHaveLength(2);
    expect(allowedCapabilityEvents[0]?.data?.method).toBe("GET");
    expect(allowedCapabilityEvents[1]?.data?.outcome).toBe("success");

    const approvalResponse = await capstan.app.fetch(
      new Request("http://localhost/ops/approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "request-approval",
          "X-Trace-Id": "trace-approval",
        },
        body: JSON.stringify({ reason: "review me" }),
      }),
    );

    expect(approvalResponse.status).toBe(202);
    const approvalBody = (await approvalResponse.json()) as {
      status: string;
      approvalId: string;
      reason: string;
    };
    expect(approvalBody.status).toBe("approval_required");
    expect(approvalBody.reason).toContain("review");

    const approvalEvents = await ops.queryEvents({
      kinds: ["approval"],
      requestId: "request-approval",
    });
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0]?.phase).toBe("requested");

    const directApproval = await createApproval({
      method: "POST",
      path: "/ops/direct-approval",
      input: { reason: "manual" },
      policy: "manual-review",
      reason: "manual review requested",
      ctx: buildApprovalContext(ops),
    });

    await resolveApproval(
      directApproval.id,
      "approved",
      "ops-reviewer",
      buildApprovalContext(ops),
    );

    const resolvedApprovalEvents = await ops.queryEvents({
      kinds: ["approval"],
      requestId: "approval-request",
    });
    expect(resolvedApprovalEvents.map((event) => event.phase)).toEqual([
      "requested",
      "resolved",
    ]);

    const deniedResponse = await capstan.app.fetch(
      new Request("http://localhost/ops/denied", {
        headers: {
          "X-Request-Id": "request-denied",
          "X-Trace-Id": "trace-denied",
        },
      }),
    );

    expect(deniedResponse.status).toBe(403);

    const policyEvents = await ops.queryEvents({
      kinds: ["policy"],
      requestId: "request-denied",
    });
    expect(policyEvents).toHaveLength(1);
    expect(policyEvents[0]?.data?.effect).toBe("deny");
    expect(policyEvents[0]?.incidentFingerprint).toContain("policy:deny-all:deny");

    const healthEvents = await ops.queryEvents({ kinds: ["health"] });
    expect(healthEvents.length).toBeGreaterThan(0);
    expect(healthEvents[0]?.data?.snapshot.status).toBeDefined();

    const incidents = await ops.queryIncidents();
    expect(
      incidents.some((incident) => incident.fingerprint === "policy:deny-all:deny"),
    ).toBe(true);
  });
});
