import { describe, expect, it } from "bun:test";

import * as ops from "../../packages/ops/src/index.ts";

type OpsEventRecord = typeof import("../../packages/ops/src/index.ts").OpsEventRecord;
type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;

const opsApi = ops as Record<string, unknown>;
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined;
};
const createCapstanOpsRuntime = opsApi.createCapstanOpsRuntime as (options: {
  store: InstanceType<typeof InMemoryOpsStore>;
  serviceName?: string;
}) => {
  recordEvent(event: Omit<OpsEventRecord, "id"> & { id?: string }): Promise<OpsEventRecord>;
  recordIncident(incident: Omit<OpsIncidentRecord, "id"> & { id?: string }): Promise<OpsIncidentRecord>;
  recordRecoveryFromEvent(event: Omit<OpsEventRecord, "id"> & { id?: string }): Promise<OpsEventRecord>;
};

describe("ops incident lifecycle", () => {
  it("merges a resolved incident update into the existing fingerprint instead of keeping it open", async () => {
    const store = new InMemoryOpsStore();
    const runtime = createCapstanOpsRuntime({ store, serviceName: "ops-test" });

    const opened = await runtime.recordIncident({
      fingerprint: "approval:approval-1",
      kind: "approval.requested",
      timestamp: "2026-04-04T00:00:01.000Z",
      severity: "warning",
      status: "open",
      title: "Approval Workflow",
      summary: "Approval approval-1 requested",
      target: "approval",
      scope: {
        app: "ops-test",
        approvalId: "approval-1",
      },
      metadata: {
        phase: "requested",
      },
    });

    const resolved = await runtime.recordIncident({
      fingerprint: "approval:approval-1",
      kind: "approval.resolved",
      timestamp: "2026-04-04T00:00:02.000Z",
      severity: "info",
      status: "resolved",
      title: "Approval Workflow",
      summary: "Approval approval-1 approved",
      target: "approval",
      scope: {
        app: "ops-test",
        approvalId: "approval-1",
      },
      metadata: {
        phase: "resolved",
      },
    });

    expect(opened.id).toBe(resolved.id);
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBe("2026-04-04T00:00:02.000Z");
    expect(resolved.observations).toBe(2);
    expect(store.getIncidentByFingerprint("approval:approval-1")?.status).toBe("resolved");
  });

  it("records explicit recovery events by resolving the existing incident ledger entry", async () => {
    const store = new InMemoryOpsStore();
    const runtime = createCapstanOpsRuntime({ store, serviceName: "ops-test" });

    await runtime.recordEvent({
      id: "evt-1",
      kind: "http.request",
      timestamp: "2026-04-04T00:00:01.000Z",
      severity: "error",
      status: "error",
      target: "runtime",
      scope: {
        app: "ops-test",
        route: "/api/broken",
      },
      summary: "GET /api/broken returned 500",
      message: "Broken route returned 500",
      fingerprint: "request:GET:/api/broken:5xx",
      tags: ["runtime"],
      metadata: {},
    });

    await runtime.recordRecoveryFromEvent({
      id: "evt-2",
      kind: "http.recovery",
      timestamp: "2026-04-04T00:00:05.000Z",
      severity: "info",
      status: "ok",
      target: "runtime",
      scope: {
        app: "ops-test",
        route: "/api/broken",
      },
      summary: "GET /api/broken recovered",
      message: "Broken route recovered",
      fingerprint: "request:GET:/api/broken:5xx",
      tags: ["runtime", "recovery"],
      metadata: {},
    });

    const incident = store.getIncidentByFingerprint("request:GET:/api/broken:5xx");
    expect(incident?.status).toBe("resolved");
    expect(incident?.resolvedAt).toBe("2026-04-04T00:00:05.000Z");
    expect(incident?.metadata.recoveryEventId).toBe("evt-2");
  });
});
