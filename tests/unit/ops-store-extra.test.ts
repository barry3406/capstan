import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ops from "../../packages/ops/src/index.ts";

type OpsEventRecord = typeof import("../../packages/ops/src/index.ts").OpsEventRecord;
type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;
type OpsSnapshotRecord = typeof import("../../packages/ops/src/index.ts").OpsSnapshotRecord;

const opsApi = ops as Record<string, unknown>;
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  addEvent(event: OpsEventRecord): OpsEventRecord;
  addIncident(incident: OpsIncidentRecord): OpsIncidentRecord;
  addSnapshot(snapshot: OpsSnapshotRecord): OpsSnapshotRecord;
  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined;
  listEvents(filters?: Record<string, unknown>): OpsEventRecord[];
  listIncidents(filters?: Record<string, unknown>): OpsIncidentRecord[];
  listSnapshots(filters?: Record<string, unknown>): OpsSnapshotRecord[];
  compact(options?: { now?: string }): { eventsRemoved: number; incidentsRemoved: number; snapshotsRemoved: number };
};
const SqliteOpsStore = opsApi.SqliteCapstanOpsStore as new (options: {
  path: string;
  retention?: { events?: { maxAgeMs?: number }; incidents?: { maxAgeMs?: number }; snapshots?: { maxAgeMs?: number } };
}) => {
  addEvent(event: OpsEventRecord): OpsEventRecord;
  addIncident(incident: OpsIncidentRecord): OpsIncidentRecord;
  addSnapshot(snapshot: OpsSnapshotRecord): OpsSnapshotRecord;
  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined;
  listEvents(filters?: Record<string, unknown>): OpsEventRecord[];
  listIncidents(filters?: Record<string, unknown>): OpsIncidentRecord[];
  listSnapshots(filters?: Record<string, unknown>): OpsSnapshotRecord[];
  compact(options?: { now?: string }): { eventsRemoved: number; incidentsRemoved: number; snapshotsRemoved: number };
  close(): Promise<void>;
};
const createOpsQuery = opsApi.createCapstanOpsQuery as (store: unknown) => {
  events(filters?: Record<string, unknown>): OpsEventRecord[];
  incidents(filters?: Record<string, unknown>): OpsIncidentRecord[];
  snapshots(filters?: Record<string, unknown>): OpsSnapshotRecord[];
};
const createOpsQueryIndex = opsApi.createCapstanOpsQueryIndex as (store: unknown) => unknown;
const createOpsOverview = opsApi.createCapstanOpsOverview as (
  query: ReturnType<typeof createOpsQuery>,
  index: ReturnType<typeof createOpsQueryIndex>,
) => {
  totals: { events: number; incidents: number; snapshots: number };
  incidents: { open: number; acknowledged: number; suppressed: number; resolved: number };
  health: { status: string; summary: string; signals: unknown[] };
  windows: { recentEvents: OpsEventRecord[]; recentIncidents: OpsIncidentRecord[]; recentSnapshots: OpsSnapshotRecord[] };
  index: unknown;
};

const tempRoots: string[] = [];

function event(id: string, timestamp: string, overrides: Partial<OpsEventRecord> = {}): OpsEventRecord {
  return {
    id,
    kind: overrides.kind ?? "http.request",
    timestamp,
    severity: overrides.severity ?? "info",
    status: overrides.status ?? "ok",
    target: overrides.target ?? "runtime",
    scope: overrides.scope ?? { app: "ops-store" },
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
    kind: overrides.kind ?? "http.response",
    timestamp,
    severity: overrides.severity ?? "warning",
    status: overrides.status ?? "open",
    title: overrides.title ?? "incident",
    summary: overrides.summary ?? "incident",
    target: overrides.target,
    scope: overrides.scope ?? { app: "ops-store" },
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

function snapshot(
  id: string,
  timestamp: string,
  health: OpsSnapshotRecord["health"],
  overrides: Partial<OpsSnapshotRecord> = {},
): OpsSnapshotRecord {
  return {
    id,
    timestamp,
    health,
    summary: overrides.summary ?? `${health} snapshot`,
    signals: overrides.signals ?? [],
    ...(overrides.scope ? { scope: overrides.scope } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

async function createSqlitePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capstan-ops-store-extra-"));
  tempRoots.push(root);
  return join(root, "ops.db");
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) {
      continue;
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe("ops store extra", () => {
  it("filters incidents by target even when some records do not declare a target", () => {
    const store = new InMemoryOpsStore();
    store.addIncident(incident("inc-runtime", "fingerprint:runtime", "2026-04-04T00:00:01.000Z", { target: "runtime" }));
    store.addIncident(incident("inc-ops", "fingerprint:ops", "2026-04-04T00:00:02.000Z", { target: "ops" }));
    store.addIncident(incident("inc-targetless", "fingerprint:none", "2026-04-04T00:00:03.000Z", { target: undefined }));

    const filtered = store.listIncidents({ targets: ["runtime"], sort: "asc" });
    expect(filtered.map((item) => item.id)).toEqual(["inc-runtime"]);
  });

  it("keeps exact-cutoff rows during compaction and preserves fingerprint lookup after repacking", async () => {
    const sqlitePath = await createSqlitePath();

    const now = Date.now() + 60_000;
    const cutoffTs = new Date(now - 1000).toISOString();
    const oldTs = new Date(now - 1001).toISOString();
    const compactNow = new Date(now).toISOString();

    const stores = [
      new InMemoryOpsStore({
        retention: {
          events: { maxAgeMs: 1000 },
          incidents: { maxAgeMs: 1000 },
          snapshots: { maxAgeMs: 1000 },
        },
      }),
      new SqliteOpsStore({
        path: sqlitePath,
        retention: {
          events: { maxAgeMs: 1000 },
          incidents: { maxAgeMs: 1000 },
          snapshots: { maxAgeMs: 1000 },
        },
      }),
    ];

    for (const store of stores) {
      store.addEvent(event("evt-cutoff", cutoffTs, { kind: "policy.decision", severity: "warning", status: "deny" }));
      store.addEvent(event("evt-old", oldTs, { kind: "policy.decision", severity: "warning", status: "deny" }));
      store.addIncident(incident("inc-cutoff", "fingerprint:cutoff", cutoffTs, { target: "runtime" }));
      store.addIncident(incident("inc-old", "fingerprint:old", oldTs, { target: "runtime" }));
      store.addSnapshot(snapshot("snap-cutoff", cutoffTs, "degraded"));
      store.addSnapshot(snapshot("snap-old", oldTs, "unhealthy"));

      const pruned = store.compact({ now: compactNow });
      expect(pruned.eventsRemoved).toBe(1);
      expect(pruned.incidentsRemoved).toBe(1);
      expect(pruned.snapshotsRemoved).toBe(1);

      expect(store.listEvents({ sort: "asc" }).map((item) => item.id)).toEqual(["evt-cutoff"]);
      expect(store.listIncidents({ sort: "asc" }).map((item) => item.id)).toEqual(["inc-cutoff"]);
      expect(store.listSnapshots({ sort: "asc" }).map((item) => item.id)).toEqual(["snap-cutoff"]);
      expect(store.getIncidentByFingerprint("fingerprint:cutoff")?.id).toBe("inc-cutoff");
    }
  });

  it("builds a stable overview from live query indexes and latest snapshots", () => {
    const store = new InMemoryOpsStore();
    store.addEvent(event("evt-warning", "2026-04-04T00:00:01.000Z", {
      kind: "http.request",
      severity: "warning",
      status: "warn",
      target: "runtime",
      summary: "warning request",
    }));
    store.addEvent(event("evt-error", "2026-04-04T00:00:02.000Z", {
      kind: "capability.invoke",
      severity: "error",
      status: "error",
      target: "capability",
      summary: "capability failed",
    }));
    store.addIncident(incident("inc-open", "fingerprint:open", "2026-04-04T00:00:02.500Z", {
      severity: "critical",
      status: "open",
      target: "runtime",
      summary: "open incident",
    }));
    store.addIncident(incident("inc-resolved", "fingerprint:resolved", "2026-04-04T00:00:03.000Z", {
      severity: "warning",
      status: "resolved",
      target: "runtime",
      summary: "resolved incident",
    }));
    store.addSnapshot(snapshot("snap-a", "2026-04-04T00:00:02.000Z", "healthy"));
    store.addSnapshot(snapshot("snap-b", "2026-04-04T00:00:04.000Z", "degraded", {
      summary: "latest degraded snapshot",
      signals: [
        {
          key: "snapshot:latest",
          source: "snapshot",
          severity: "warning",
          status: "degraded",
          title: "latest",
          summary: "latest degraded snapshot",
        },
      ],
    }));

    const query = createOpsQuery(store);
    const overview = createOpsOverview(query, createOpsQueryIndex(store));

    expect(overview.totals.events).toBe(2);
    expect(overview.totals.incidents).toBe(2);
    expect(overview.totals.snapshots).toBe(2);
    expect(overview.incidents.open).toBe(1);
    expect(overview.incidents.resolved).toBe(1);
    expect(overview.windows.recentSnapshots.at(-1)?.id).toBe("snap-b");
    expect(overview.health.status).toBe("unhealthy");
    expect(overview.health.signals.length).toBeGreaterThanOrEqual(1);
  });
});
