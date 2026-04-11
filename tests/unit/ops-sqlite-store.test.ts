import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ops from "../../packages/ops/src/index.ts";

type OpsEventRecord = typeof import("../../packages/ops/src/index.ts").OpsEventRecord;
type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;

const opsApi = ops as Record<string, unknown>;
const SqliteOpsStore = opsApi.SqliteCapstanOpsStore as new (options: { path: string; retention?: { events?: { maxAgeMs: number }; incidents?: { maxAgeMs: number } } }) => {
    addEvent(event: OpsEventRecord): Promise<void>;
    addIncident(incident: OpsIncidentRecord): Promise<void>;
    listEvents(filters?: Record<string, unknown>): Promise<OpsEventRecord[]>;
    listIncidents(filters?: Record<string, unknown>): Promise<OpsIncidentRecord[]>;
    compact(options?: { now?: string }): Promise<{ eventsRemoved: number; incidentsRemoved: number }>;
    close(): Promise<void>;
  };

async function createTempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capstan-ops-sqlite-"));
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

function incident(id: string, fingerprint: string, timestamp: string): OpsIncidentRecord {
  return {
    id,
    fingerprint,
    kind: "http.response",
    severity: "critical",
    status: "open",
    title: "runtime failure",
    summary: "runtime failure",
    scope: { app: "alpha" },
    metadata: {},
    timestamp,
  };
}

describe("ops sqlite store", () => {
  let createdPaths: string[] = [];

  afterEach(async () => {
    for (const filePath of createdPaths) {
      try {
        await rm(filePath, { force: true });
      } catch {
        // Ignore cleanup errors in temp directories.
      }
    }
    createdPaths = [];
  });

  it("persists events and incidents across reopen with stable order", async () => {
    const dbPath = await createTempDbPath();
    createdPaths.push(dbPath, dbPath.replace(/\.db$/, ""));

    {
      const store = new SqliteOpsStore({ path: dbPath });
      await store.addEvent(event("evt-1", "2026-04-04T00:00:01.000Z"));
      await store.addEvent(event("evt-2", "2026-04-04T00:00:02.000Z"));
      await store.addIncident(incident("inc-1", "http:/health:500", "2026-04-04T00:00:03.000Z"));
      await store.close();
    }

    {
      const reopened = new SqliteOpsStore({ path: dbPath });
      const events = await reopened.listEvents();
      const incidents = await reopened.listIncidents();

      expect(events.map((item) => item.id)).toEqual(["evt-1", "evt-2"]);
      expect(incidents.map((item) => item.id)).toEqual(["inc-1"]);
      await reopened.close();
    }
  });

  it("retains only the configured window and prunes older rows when compaction runs", async () => {
    const dbPath = await createTempDbPath();
    createdPaths.push(dbPath, dbPath.replace(/\.db$/, ""));

    const store = new SqliteOpsStore({
      path: dbPath,
      retention: {
        events: { maxAgeMs: 1000 },
        incidents: { maxAgeMs: 1000 },
      },
    });

    const now = Date.now();
    const oldTs = new Date(now - 5000).toISOString();
    const newTs = new Date(now + 60_000).toISOString();
    const compactNow = new Date(now).toISOString();

    await store.addEvent(event("evt-old", oldTs));
    await store.addEvent(event("evt-new", newTs));
    await store.addIncident(incident("inc-old", "fingerprint:old", oldTs));
    await store.addIncident(incident("inc-new", "fingerprint:new", newTs));

    const pruned = await store.compact({
      now: compactNow,
    });

    expect(pruned.eventsRemoved).toBeGreaterThanOrEqual(1);
    expect(pruned.incidentsRemoved).toBeGreaterThanOrEqual(1);

    const events = await store.listEvents();
    const incidents = await store.listIncidents();
    expect(events.map((item) => item.id)).toEqual(["evt-new"]);
    expect(incidents.map((item) => item.id)).toEqual(["inc-new"]);
    await store.close();
  });

  it("supports scoped filtering after persistence", async () => {
    const dbPath = await createTempDbPath();
    createdPaths.push(dbPath, dbPath.replace(/\.db$/, ""));

    const store = new SqliteOpsStore({ path: dbPath });
    await store.addEvent({
      ...event("evt-1", "2026-04-04T00:00:01.000Z"),
      scope: { app: "alpha", route: "/health" },
      tags: ["runtime", "web"],
    });
    await store.addEvent({
      ...event("evt-2", "2026-04-04T00:00:02.000Z"),
      scope: { app: "beta", route: "/ops" },
      tags: ["release"],
      target: "release",
    });

    const filtered = await store.listEvents({
      scopes: [{ key: "app", values: ["alpha"] }],
      tags: ["runtime"],
    });

    expect(filtered.map((item) => item.id)).toEqual(["evt-1"]);
    await store.close();
  });
});
