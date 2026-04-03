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
const createOpsOverview = opsApi.createCapstanOpsOverview as (query: ReturnType<typeof createOpsQuery>, index: ReturnType<typeof createOpsQueryIndex>) => {
  totals: { events: number; incidents: number };
  incidents: { open: number };
  windows: { recentEvents: OpsEventRecord[]; recentIncidents: OpsIncidentRecord[] };
  health: { status: string; signals: Array<{ severity: string }> };
};
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  addEvent(event: OpsEventRecord): void;
  addIncident(incident: OpsIncidentRecord): void;
};

function event(id: string, kind: string, timestamp: string, severity: OpsEventRecord["severity"]): OpsEventRecord {
  return {
    id,
    kind,
    timestamp,
    severity,
    status: severity === "error" ? "error" : severity === "warning" ? "warn" : "ok",
    target: kind.startsWith("release") ? "release" : "runtime",
    scope: { app: "alpha" },
    metadata: {},
    tags: [kind.split(".")[0] ?? kind],
  };
}

function incident(id: string, fingerprint: string, kind: string, timestamp: string, severity: OpsIncidentRecord["severity"], status: OpsIncidentRecord["status"]): OpsIncidentRecord {
  return {
    id,
    fingerprint,
    kind,
    timestamp,
    severity,
    status,
    title: `${kind} incident`,
    summary: `${kind} incident`,
    scope: { app: "alpha" },
    metadata: {},
  };
}

describe("ops overview", () => {
  it("rolls up recent events, open incidents, and health status from the same store", () => {
    const store = new InMemoryOpsStore({
      eventRetentionMs: 60_000,
      incidentRetentionMs: 60_000,
    });

    store.addEvent(event("evt-1", "http.request", "2026-04-04T00:00:01.000Z", "info"));
    store.addEvent(event("evt-2", "release.verify", "2026-04-04T00:00:02.000Z", "warning"));
    store.addEvent(event("evt-3", "policy.deny", "2026-04-04T00:00:03.000Z", "error"));
    store.addIncident(incident("inc-1", "release:missing-env", "release.verify", "2026-04-04T00:00:04.000Z", "warning", "open"));
    store.addIncident(incident("inc-2", "policy:denied", "policy.deny", "2026-04-04T00:00:05.000Z", "critical", "suppressed"));

    const query = createOpsQuery(store);
    const overview = createOpsOverview(query, createOpsQueryIndex(store));

    expect(overview.totals.events).toBe(3);
    expect(overview.totals.incidents).toBe(2);
    expect(overview.incidents.open).toBe(1);
    expect(["healthy", "degraded", "unhealthy"]).toContain(overview.health.status);
    expect(overview.windows.recentEvents[0]?.kind).toBe("http.request");
    expect(overview.windows.recentIncidents[0]?.fingerprint).toBe("release:missing-env");
  });

  it("degrades health when recent error rate or critical incidents cross threshold", () => {
    const store = new InMemoryOpsStore();

    for (let index = 0; index < 5; index++) {
      store.addEvent(
        event(
          `evt-${index}`,
          index < 4 ? "http.request" : "release.verify",
          `2026-04-04T00:00:0${index + 1}.000Z`,
          index === 4 ? "error" : "info",
        ),
      );
    }
    store.addIncident(incident("inc-1", "runtime:db-down", "runtime.health", "2026-04-04T00:00:06.000Z", "critical", "open"));

    const overview = createOpsOverview(createOpsQuery(store), createOpsQueryIndex(store));
    expect(["degraded", "unhealthy"]).toContain(overview.health.status);
    expect(overview.health.signals.some((signal) => signal.severity === "critical")).toBe(true);
  });
});
