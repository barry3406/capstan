import { describe, expect, it } from "bun:test";

import * as ops from "../../packages/ops/src/index.ts";

type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;

const opsApi = ops as Record<string, unknown>;
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  addIncident(incident: OpsIncidentRecord): OpsIncidentRecord;
  listIncidents(filters?: Record<string, unknown>): OpsIncidentRecord[];
};
const createCapstanOpsRuntime = opsApi.createCapstanOpsRuntime as (options: {
  store: InstanceType<typeof InMemoryOpsStore>;
  serviceName?: string;
  environment?: string;
}) => {
  recordIncident(incident: OpsIncidentRecord): Promise<OpsIncidentRecord>;
  recordRecoveryFromEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>;
  createOverview(): {
    incidents: { open: number; acknowledged: number; suppressed: number; resolved: number };
    health: { status: string; summary: string; signals: Array<{ severity: string; summary: string }> };
  };
};

function event(
  id: string,
  timestamp: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: overrides.kind ?? "approval",
    timestamp,
    severity: overrides.severity ?? "info",
    status: overrides.status ?? "resolved",
    target: overrides.target ?? "approval",
    scope: overrides.scope ?? { app: "ops-runtime" },
    tags: overrides.tags ?? ["ops"],
    metadata: overrides.metadata ?? {},
    ...(overrides.title ? { title: overrides.title } : {}),
    ...(overrides.summary ? { summary: overrides.summary } : {}),
    ...(overrides.message ? { message: overrides.message } : {}),
    ...(overrides.fingerprint ? { fingerprint: overrides.fingerprint } : {}),
    ...(overrides.correlation ? { correlation: overrides.correlation } : {}),
  };
}

function incident(
  id: string,
  fingerprint: string,
  timestamp: string,
  overrides: Partial<OpsIncidentRecord> = {},
): OpsIncidentRecord {
  return {
    id,
    fingerprint,
    kind: overrides.kind ?? "runtime.health",
    timestamp,
    severity: overrides.severity ?? "warning",
    status: overrides.status ?? "open",
    title: overrides.title ?? "incident",
    summary: overrides.summary ?? "incident",
    target: overrides.target,
    scope: overrides.scope ?? { app: "ops-runtime" },
    tags: overrides.tags ?? ["ops"],
    metadata: overrides.metadata ?? {},
    ...(overrides.correlation ? { correlation: overrides.correlation } : {}),
    ...(overrides.firstSeenAt ? { firstSeenAt: overrides.firstSeenAt } : {}),
    ...(overrides.lastSeenAt ? { lastSeenAt: overrides.lastSeenAt } : {}),
    ...(overrides.resolvedAt ? { resolvedAt: overrides.resolvedAt } : {}),
    ...(overrides.observations !== undefined ? { observations: overrides.observations } : {}),
    ...(overrides.lastEventId ? { lastEventId: overrides.lastEventId } : {}),
  };
}

describe("ops runtime dedupe edge cases", () => {
  it("treats suppressed critical incidents as unhealthy in the runtime overview", async () => {
    const store = new InMemoryOpsStore();
    const runtime = createCapstanOpsRuntime({
      store,
      serviceName: "ops-runtime",
      environment: "development",
    });

    await runtime.recordIncident(
      incident("inc-critical", "deploy:edge:blocked", "2026-04-04T00:00:01.000Z", {
        severity: "critical",
        status: "suppressed",
        kind: "deploy.verify",
        target: "release",
        title: "edge deploy blocked",
        summary: "edge deploy blocked by node-only import",
        metadata: { target: "cloudflare" },
      }),
    );

    const overview = runtime.createOverview();

    expect(overview.incidents.suppressed).toBe(1);
    expect(overview.health.status).toBe("unhealthy");
    expect(overview.health.summary).toContain("Unhealthy");
    expect(overview.health.signals[0]?.severity).toBe("critical");
  });

  it("treats acknowledged warning incidents as degraded in the runtime overview", async () => {
    const store = new InMemoryOpsStore();
    const runtime = createCapstanOpsRuntime({
      store,
      serviceName: "ops-runtime",
      environment: "development",
    });

    await runtime.recordIncident(
      incident("inc-warning", "approval:pending", "2026-04-04T00:00:01.000Z", {
        severity: "warning",
        status: "acknowledged",
        kind: "approval.request",
        target: "approval",
        title: "approval pending",
        summary: "approval is still waiting on review",
      }),
    );

    const overview = runtime.createOverview();

    expect(overview.incidents.acknowledged).toBe(1);
    expect(overview.health.status).toBe("degraded");
    expect(overview.health.summary).toContain("Degraded");
    expect(overview.health.signals[0]?.severity).toBe("warning");
  });

  it("resolves a suppressed incident from a recovery event and removes it from the active overview", async () => {
    const store = new InMemoryOpsStore();
    const runtime = createCapstanOpsRuntime({
      store,
      serviceName: "ops-runtime",
      environment: "development",
    });

    await runtime.recordIncident(
      incident("inc-suppressed", "approval:manual-review", "2026-04-04T00:00:01.000Z", {
        severity: "warning",
        status: "suppressed",
        kind: "approval.request",
        target: "approval",
        title: "manual review pending",
        summary: "manual review is still pending",
      }),
    );

    const recoveryEvent = await runtime.recordRecoveryFromEvent(
      event("evt-recovery", "2026-04-04T00:00:02.000Z", {
        kind: "approval",
        status: "resolved",
        severity: "info",
        target: "approval",
        fingerprint: "approval:manual-review",
        summary: "manual review finished",
      }),
    );

    const resolved = store.getIncidentByFingerprint("approval:manual-review");
    const overview = runtime.createOverview();

    expect(recoveryEvent.id).toBe("evt-recovery");
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt).toBe("2026-04-04T00:00:02.000Z");
    expect(overview.incidents.suppressed).toBe(0);
    expect(overview.incidents.resolved).toBe(1);
    expect(overview.health.status).toBe("healthy");
  });
});
