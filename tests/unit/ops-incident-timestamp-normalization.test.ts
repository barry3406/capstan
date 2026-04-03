import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ops from "../../packages/ops/src/index.ts";

type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;

const opsApi = ops as Record<string, unknown>;
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  addIncident(incident: OpsIncidentRecord): OpsIncidentRecord;
  getIncident(id: string): OpsIncidentRecord | undefined;
};
const SqliteOpsStore = opsApi.SqliteCapstanOpsStore as new (options: { path: string }) => {
  addIncident(incident: OpsIncidentRecord): OpsIncidentRecord;
  getIncident(id: string): OpsIncidentRecord | undefined;
  close(): Promise<void>;
};
const createCapstanOpsRuntime = opsApi.createCapstanOpsRuntime as (options: {
  store: InstanceType<typeof InMemoryOpsStore>;
  serviceName?: string;
  environment?: string;
}) => {
  recordIncident(incident: OpsIncidentRecord): Promise<OpsIncidentRecord>;
};

const tempRoots: string[] = [];

function incident(
  id: string,
  fingerprint: string,
  overrides: Partial<OpsIncidentRecord> = {},
): OpsIncidentRecord {
  return {
    id,
    fingerprint,
    kind: overrides.kind ?? "runtime.health",
    timestamp: overrides.timestamp ?? "2026-04-04T08:00:00+08:00",
    severity: overrides.severity ?? "warning",
    status: overrides.status ?? "open",
    title: overrides.title ?? "incident",
    summary: overrides.summary ?? "incident",
    target: overrides.target ?? "runtime",
    scope: overrides.scope ?? { app: "ops-incident-normalization" },
    tags: overrides.tags ?? ["ops"],
    metadata: overrides.metadata ?? {},
    ...(overrides.firstSeenAt ? { firstSeenAt: overrides.firstSeenAt } : {}),
    ...(overrides.lastSeenAt ? { lastSeenAt: overrides.lastSeenAt } : {}),
    ...(overrides.resolvedAt ? { resolvedAt: overrides.resolvedAt } : {}),
  };
}

async function createSqlitePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capstan-ops-incident-normalization-"));
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

describe("ops incident timestamp normalization", () => {
  it("normalizes lifecycle timestamps for direct in-memory incident writes", () => {
    const store = new InMemoryOpsStore();

    const saved = store.addIncident(
      incident("inc-memory", "runtime:memory", {
        firstSeenAt: "2026-04-04T08:00:00+08:00",
        lastSeenAt: "2026-04-04T08:05:00+08:00",
        resolvedAt: "2026-04-04T08:10:00+08:00",
        status: "resolved",
      }),
    );

    expect(saved.timestamp).toBe("2026-04-04T00:00:00.000Z");
    expect(saved.firstSeenAt).toBe("2026-04-04T00:00:00.000Z");
    expect(saved.lastSeenAt).toBe("2026-04-04T00:05:00.000Z");
    expect(saved.resolvedAt).toBe("2026-04-04T00:10:00.000Z");
    expect(store.getIncident("inc-memory")?.lastSeenAt).toBe("2026-04-04T00:05:00.000Z");
  });

  it("normalizes lifecycle timestamps for sqlite incident writes", async () => {
    const sqlitePath = await createSqlitePath();
    const store = new SqliteOpsStore({ path: sqlitePath });

    const saved = store.addIncident(
      incident("inc-sqlite", "runtime:sqlite", {
        firstSeenAt: "2026-04-04T08:00:00+08:00",
        lastSeenAt: "2026-04-04T08:05:00+08:00",
        resolvedAt: "2026-04-04T08:10:00+08:00",
        status: "resolved",
      }),
    );

    expect(saved.timestamp).toBe("2026-04-04T00:00:00.000Z");
    expect(saved.firstSeenAt).toBe("2026-04-04T00:00:00.000Z");
    expect(saved.lastSeenAt).toBe("2026-04-04T00:05:00.000Z");
    expect(saved.resolvedAt).toBe("2026-04-04T00:10:00.000Z");
    expect(store.getIncident("inc-sqlite")?.resolvedAt).toBe("2026-04-04T00:10:00.000Z");

    await store.close();
  });

  it("normalizes runtime-managed first and last seen timestamps when recording incidents", async () => {
    const store = new InMemoryOpsStore();
    const runtime = createCapstanOpsRuntime({
      store,
      serviceName: "ops-runtime",
      environment: "development",
    });

    const saved = await runtime.recordIncident(
      incident("inc-runtime", "runtime:runtime", {
        timestamp: "2026-04-04T08:00:00+08:00",
      }),
    );

    expect(saved.timestamp).toBe("2026-04-04T00:00:00.000Z");
    expect(saved.firstSeenAt).toBe("2026-04-04T00:00:00.000Z");
    expect(saved.lastSeenAt).toBe("2026-04-04T00:00:00.000Z");
  });
});
