import { describe, expect, it } from "bun:test";

import * as ops from "../../packages/ops/src/index.ts";

type OpsSnapshotRecord = typeof import("../../packages/ops/src/index.ts").OpsSnapshotRecord;

const opsApi = ops as Record<string, unknown>;
const createOpsQuery = opsApi.createCapstanOpsQuery as (store: unknown) => {
  snapshots: (filters?: Record<string, unknown>) => OpsSnapshotRecord[];
};
const createOpsQueryIndex = opsApi.createCapstanOpsQueryIndex as (store: unknown) => unknown;
const createOpsOverview = opsApi.createCapstanOpsOverview as (
  query: ReturnType<typeof createOpsQuery>,
  index: ReturnType<typeof createOpsQueryIndex>,
) => {
  windows: { recentSnapshots: OpsSnapshotRecord[] };
  health: {
    status: string;
    summary: string;
    signals: Array<{ key: string; summary: string }>;
  };
};
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  addSnapshot(snapshot: OpsSnapshotRecord): void;
};

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
    summary: overrides.summary ?? `${id} ${health}`,
    signals: overrides.signals ?? [],
    ...(overrides.scope ? { scope: overrides.scope } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

describe("ops overview windowing", () => {
  it("uses the newest snapshot for overview health even when it falls outside the recent window", () => {
    const store = new InMemoryOpsStore();

    for (let index = 1; index <= 11; index++) {
      const isLatest = index === 11;
      store.addSnapshot(
        snapshot(
          `snap-${index}`,
          `2026-04-04T00:00:${String(index).padStart(2, "0")}.000Z`,
          isLatest ? "unhealthy" : "healthy",
          isLatest
            ? {
                summary: "latest snapshot reports an unhealthy release",
                signals: [
                  {
                    key: "snapshot:11",
                    source: "snapshot",
                    severity: "critical",
                    status: "unhealthy",
                    title: "latest snapshot",
                    summary: "latest snapshot reports an unhealthy release",
                  },
                ],
              }
            : undefined,
        ),
      );
    }

    const overview = createOpsOverview(createOpsQuery(store), createOpsQueryIndex(store));

    expect(overview.windows.recentSnapshots).toHaveLength(10);
    expect(overview.windows.recentSnapshots.at(-1)?.id).toBe("snap-10");
    expect(overview.health.status).toBe("unhealthy");
    expect(overview.health.signals.some((signal) => signal.key === "snapshot:11")).toBe(true);
    expect(overview.health.summary).toContain("latest snapshot reports an unhealthy release");
  });
});
