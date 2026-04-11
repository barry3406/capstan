import { afterEach, describe, expect, it } from "bun:test";

import {
  clearApprovals,
  createApproval,
  createCapstanOpsContext,
  resolveApproval,
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
  ops = createCapstanOpsContext({ appName: "ops-approval-test" })!,
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

describe("ops core approval lifecycle", () => {
  afterEach(async () => {
    await clearApprovals();
  });

  it("keeps a single approval incident fingerprint and marks it resolved after approval closes", async () => {
    const ops = createCapstanOpsContext({
      appName: "ops-approval-test",
      source: "unit-test",
    })!;

    const approval = await createApproval({
      method: "POST",
      path: "/api/approval",
      input: { reason: "manual review" },
      policy: "needs-approval",
      reason: "manual review requested",
      ctx: buildApprovalContext(ops),
    });

    await resolveApproval(
      approval.id,
      "approved",
      "reviewer-1",
      buildApprovalContext(ops),
    );

    const incidents = await ops.queryIncidents({
      incidentFingerprint: `approval:${approval.id}`,
    });

    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.fingerprint).toBe(`approval:${approval.id}`);
    expect(incidents[0]?.status).toBe("resolved");
    expect(incidents[0]?.occurrences).toBe(2);
  });
});
