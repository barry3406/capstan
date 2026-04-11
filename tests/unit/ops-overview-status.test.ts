import { describe, expect, it } from "bun:test";

import * as ops from "../../packages/ops/src/index.ts";

type OpsEventRecord = typeof import("../../packages/ops/src/index.ts").OpsEventRecord;
type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;

const opsApi = ops as Record<string, unknown>;
const createOpsQuery = opsApi.createCapstanOpsQuery as (store: unknown) => {
  events: (filters?: Record<string, unknown>) => OpsEventRecord[];
  incidents: (filters?: Record<string, unknown>) => OpsIncidentRecord[];
};
const createOpsQueryIndex = opsApi.createCapstanOpsQueryIndex as (store: unknown) => unknown;
const createOpsOverview = opsApi.createCapstanOpsOverview as (
  query: ReturnType<typeof createOpsQuery>,
  index: ReturnType<typeof createOpsQueryIndex>,
) => {
  health: {
    status: string;
    signals: Array<{ fingerprint?: string; severity: string }>;
  };
  incidents: { open: number; resolved: number; acknowledged: number; suppressed: number };
};
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  addEvent(event: OpsEventRecord): void;
  addIncident(incident: OpsIncidentRecord): void;
};

function event(
  id: string,
  timestamp: string,
  severity: OpsEventRecord["severity"],
): OpsEventRecord {
  return {
    id,
    kind: "http.request",
    timestamp,
    severity,
    status: severity === "warning" ? "warn" : severity === "error" ? "error" : "ok",
    target: "runtime",
    scope: { app: "ops-overview-status" },
    tags: ["ops"],
    metadata: {},
    summary: `event ${id}`,
  };
}

function incident(
  id: string,
  fingerprint: string,
  timestamp: string,
  severity: OpsIncidentRecord["severity"],
  status: OpsIncidentRecord["status"],
): OpsIncidentRecord {
  return {
    id,
    fingerprint,
    kind: "runtime.health",
    timestamp,
    severity,
    status,
    title: id,
    summary: `${id} ${status}`,
    target: "runtime",
    scope: { app: "ops-overview-status" },
    tags: ["ops"],
    metadata: {},
  };
}

describe("ops overview status", () => {
  it("does not promote health to unhealthy when the only critical incident is already resolved", () => {
    const store = new InMemoryOpsStore();
    store.addEvent(event("evt-warning", "2026-04-04T00:00:01.000Z", "warning"));
    store.addIncident(incident("inc-critical-resolved", "runtime:critical-resolved", "2026-04-04T00:00:02.000Z", "critical", "resolved"));
    store.addIncident(incident("inc-warning-open", "runtime:warning-open", "2026-04-04T00:00:03.000Z", "warning", "open"));

    const overview = createOpsOverview(createOpsQuery(store), createOpsQueryIndex(store));

    expect(overview.incidents.open).toBe(1);
    expect(overview.incidents.resolved).toBe(1);
    expect(overview.health.status).toBe("degraded");
    expect(overview.health.signals.some((signal) => signal.fingerprint === "runtime:critical-resolved")).toBe(false);
    expect(overview.health.signals.some((signal) => signal.fingerprint === "runtime:warning-open")).toBe(true);
  });

  it("keeps health unhealthy when a critical incident is still active even without open incidents", () => {
    const store = new InMemoryOpsStore();
    store.addIncident(incident("inc-critical-ack", "runtime:critical-ack", "2026-04-04T00:00:01.000Z", "critical", "acknowledged"));

    const overview = createOpsOverview(createOpsQuery(store), createOpsQueryIndex(store));

    expect(overview.incidents.acknowledged).toBe(1);
    expect(overview.incidents.open).toBe(0);
    expect(overview.health.status).toBe("unhealthy");
    expect(overview.health.signals.some((signal) => signal.fingerprint === "runtime:critical-ack")).toBe(true);
  });
});
