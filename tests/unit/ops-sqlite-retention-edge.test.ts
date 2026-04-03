import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ops from "../../packages/ops/src/index.ts";

type OpsEventRecord = typeof import("../../packages/ops/src/index.ts").OpsEventRecord;
type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;

const opsApi = ops as Record<string, unknown>;
const SqliteOpsStore = opsApi.SqliteCapstanOpsStore as new (options: {
  path: string;
  retention?: {
    events?: { maxAgeMs: number };
    incidents?: { maxAgeMs: number };
  };
}) => {
  addEvent(event: OpsEventRecord): void;
  getEvent(id: string): OpsEventRecord | undefined;
  listEvents(filters?: Record<string, unknown>): OpsEventRecord[];
  addIncident(incident: OpsIncidentRecord): void;
  getIncident(id: string): OpsIncidentRecord | undefined;
  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined;
  listIncidents(filters?: Record<string, unknown>): OpsIncidentRecord[];
  compact(options?: { now?: string }): { eventsRemoved: number; incidentsRemoved: number };
  close(): Promise<void>;
};

async function createTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capstan-ops-sqlite-retention-"));
  return join(root, "ops.db");
}

function event(id: string, timestamp: string): OpsEventRecord {
  return {
    id,
    kind: "http.request",
    severity: "info",
    status: "ok",
    target: "runtime",
    scope: { app: "alpha" },
    tags: ["runtime"],
    metadata: {},
    timestamp,
  };
}

function incident(
  id: string,
  fingerprint: string,
  timestamp: string,
): OpsIncidentRecord {
  return {
    id,
    fingerprint,
    kind: "runtime.failure",
    severity: "critical",
    status: "open",
    title: "runtime failure",
    summary: "runtime failure",
    scope: { app: "alpha" },
    metadata: {},
    timestamp,
  };
}

describe("ops sqlite retention edges", () => {
  let createdPaths: string[] = [];

  afterEach(async () => {
    for (const filePath of createdPaths) {
      try {
        await rm(filePath, { force: true, recursive: true });
      } catch {
        // Ignore temp cleanup failures.
      }
    }
    createdPaths = [];
  });

  it("prunes expired event rows before direct getters return them", async () => {
    const dbPath = await createTempDbPath();
    createdPaths.push(dbPath, dbPath.replace(/\.db$/, ""));

    const store = new SqliteOpsStore({
      path: dbPath,
      retention: {
        events: { maxAgeMs: 1_000 },
      },
    });

    const stale = event("evt-stale", "2000-01-01T00:00:00.000Z");
    const fresh = event("evt-fresh", new Date(Date.now() + 60_000).toISOString());

    await store.addEvent(stale);
    await store.addEvent(fresh);

    expect(await store.getEvent("evt-stale")).toBeUndefined();
    expect(await store.getEvent("evt-fresh")).toMatchObject({ id: "evt-fresh" });
    expect((await store.listEvents()).map((record) => record.id)).toEqual(["evt-fresh"]);

    await store.close();
  });

  it("prunes expired incidents before direct getters and fingerprint lookups return them", async () => {
    const dbPath = await createTempDbPath();
    createdPaths.push(dbPath, dbPath.replace(/\.db$/, ""));

    const store = new SqliteOpsStore({
      path: dbPath,
      retention: {
        incidents: { maxAgeMs: 1_000 },
      },
    });

    const stale = incident("inc-stale", "runtime:stale", "2000-01-01T00:00:00.000Z");
    const fresh = incident("inc-fresh", "runtime:fresh", new Date(Date.now() + 60_000).toISOString());

    await store.addIncident(stale);
    await store.addIncident(fresh);

    expect(await store.getIncident("inc-stale")).toBeUndefined();
    expect(await store.getIncidentByFingerprint("runtime:stale")).toBeUndefined();
    expect(await store.getIncident("inc-fresh")).toMatchObject({ id: "inc-fresh" });
    expect((await store.listIncidents()).map((record) => record.id)).toEqual(["inc-fresh"]);

    await store.close();
  });

  it("keeps rows at the exact cutoff and only removes strictly older rows", async () => {
    const dbPath = await createTempDbPath();
    createdPaths.push(dbPath, dbPath.replace(/\.db$/, ""));

    const store = new SqliteOpsStore({
      path: dbPath,
      retention: {
        events: { maxAgeMs: 1_000 },
        incidents: { maxAgeMs: 1_000 },
      },
    });

    const now = "2026-04-04T00:00:03.000Z";
    const cutoffEvent = event("evt-cutoff", "2026-04-04T00:00:02.000Z");
    const staleEvent = event("evt-stale", "2026-04-04T00:00:01.999Z");
    const cutoffIncident = incident("inc-cutoff", "runtime:cutoff", "2026-04-04T00:00:02.000Z");
    const staleIncident = incident("inc-stale", "runtime:stale", "2026-04-04T00:00:01.999Z");

    await store.addEvent(cutoffEvent);
    await store.addEvent(staleEvent);
    await store.addIncident(cutoffIncident);
    await store.addIncident(staleIncident);

    const pruned = await store.compact({ now });

    expect(pruned.eventsRemoved).toBe(1);
    expect(pruned.incidentsRemoved).toBe(1);
    expect((await store.listEvents()).map((record) => record.id)).toEqual(["evt-cutoff"]);
    expect((await store.listIncidents()).map((record) => record.id)).toEqual(["inc-cutoff"]);
    expect(await store.getEvent("evt-cutoff")).toMatchObject({ id: "evt-cutoff" });
    expect(await store.getIncidentByFingerprint("runtime:cutoff")).toMatchObject({ id: "inc-cutoff" });

    await store.close();
  });
});
