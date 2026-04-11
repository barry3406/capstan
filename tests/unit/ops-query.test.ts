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
  windows: { recentEvents: OpsEventRecord[]; recentIncidents: OpsIncidentRecord[] };
  incidents: { open: number };
  health: { status: string };
};
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  addEvent(event: OpsEventRecord): void;
  addIncident(incident: OpsIncidentRecord): void;
};

function event(overrides: Partial<OpsEventRecord> & Pick<OpsEventRecord, "id" | "kind" | "scope" | "timestamp">): OpsEventRecord {
  return {
    severity: "info",
    status: "ok",
    target: "runtime",
    metadata: {},
    tags: [],
    ...overrides,
  };
}

function incident(
  overrides: Partial<OpsIncidentRecord> & Pick<OpsIncidentRecord, "id" | "kind" | "scope" | "timestamp" | "fingerprint">,
): OpsIncidentRecord {
  return {
    severity: "warning",
    status: "open",
    title: "incident",
    summary: "incident",
    metadata: {},
    ...overrides,
  };
}

describe("ops query", () => {
  it("filters events by time, kind, scope, status, target, and tags without mutating source records", () => {
    const store = new InMemoryOpsStore();
    const records: OpsEventRecord[] = [
      event({
        id: "evt-1",
        kind: "http.request",
        scope: { app: "alpha", route: "/health" },
        target: "runtime",
        status: "ok",
        severity: "info",
        tags: ["runtime", "web"],
        timestamp: "2026-04-04T00:00:01.000Z",
      }),
      event({
        id: "evt-2",
        kind: "release.verify",
        scope: { app: "alpha", target: "vercel-edge" },
        target: "release",
        status: "warn",
        severity: "warning",
        tags: ["release"],
        timestamp: "2026-04-04T00:00:02.000Z",
      }),
      event({
        id: "evt-3",
        kind: "http.request",
        scope: { app: "beta", route: "/ops" },
        target: "runtime",
        status: "error",
        severity: "error",
        tags: ["runtime", "ops"],
        timestamp: "2026-04-04T00:00:03.000Z",
      }),
    ];

    for (const record of records) {
      store.addEvent(record);
    }

    const query = createOpsQuery(store);
    const result = query.events({
      kinds: ["http.request"],
      scopes: [{ key: "app", values: ["alpha"] }],
      targets: ["runtime"],
      statuses: ["ok"],
      tags: ["runtime"],
      from: "2026-04-04T00:00:00.500Z",
      to: "2026-04-04T00:00:59.000Z",
      sort: "asc",
    });

    expect(result.map((item) => item.id)).toEqual(["evt-1"]);
    expect(records[0]?.tags).toEqual(["runtime", "web"]);
  });

  it("returns incidents in deterministic order and can narrow by fingerprint, status, and severity", () => {
    const store = new InMemoryOpsStore();
    store.addIncident(
      incident({
        id: "inc-1",
        fingerprint: "http:/health:500",
        kind: "http.response",
        scope: { app: "alpha" },
        status: "open",
        severity: "critical",
        timestamp: "2026-04-04T00:00:01.000Z",
      }),
    );
    store.addIncident(
      incident({
        id: "inc-2",
        fingerprint: "http:/health:500",
        kind: "http.response",
        scope: { app: "alpha" },
        status: "suppressed",
        severity: "critical",
        timestamp: "2026-04-04T00:00:02.000Z",
      }),
    );
    store.addIncident(
      incident({
        id: "inc-3",
        fingerprint: "release:missing-env",
        kind: "release.verify",
        scope: { app: "beta" },
        status: "open",
        severity: "warning",
        timestamp: "2026-04-04T00:00:03.000Z",
      }),
    );

    const query = createOpsQuery(store);
    const openCritical = query.incidents({
      fingerprints: ["http:/health:500"],
      statuses: ["open"],
      severities: ["critical"],
      sort: "desc",
    });

    expect(openCritical.map((item) => item.id)).toEqual(["inc-1"]);
    expect(query.incidents({ kinds: ["release.verify"] }).map((item) => item.id)).toEqual(["inc-3"]);
  });

  it("builds an overview with counts derived from the live query index", () => {
    const store = new InMemoryOpsStore();
    const query = createOpsQuery(store);
    store.addEvent(
      event({
        id: "evt-1",
        kind: "http.request",
        scope: { app: "alpha" },
        status: "ok",
        severity: "info",
        timestamp: "2026-04-04T00:00:01.000Z",
      }),
    );
    store.addIncident(
      incident({
        id: "inc-1",
        fingerprint: "http:/health:500",
        kind: "http.response",
        scope: { app: "alpha" },
        severity: "critical",
        status: "open",
        timestamp: "2026-04-04T00:00:02.000Z",
      }),
    );

    const overview = createOpsOverview(query, createOpsQueryIndex(store));
    expect(overview.totals.events).toBe(1);
    expect(overview.totals.incidents).toBe(1);
    expect(overview.health.status).toBeDefined();
    expect(overview.windows.recentEvents.length).toBe(1);
  });
});
