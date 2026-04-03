import { describe, expect, it } from "bun:test";

import * as ops from "../../packages/ops/src/index.ts";

type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;
type OpsSnapshotRecord = typeof import("../../packages/ops/src/index.ts").OpsSnapshotRecord;

const opsApi = ops as Record<string, unknown>;
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (...args: any[]) => {
  addEvent(event: Record<string, unknown>): Record<string, unknown>;
  addIncident(incident: OpsIncidentRecord): OpsIncidentRecord;
  addSnapshot(snapshot: OpsSnapshotRecord): OpsSnapshotRecord;
  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined;
  listEvents(filters?: Record<string, unknown>): Record<string, unknown>[];
  listIncidents(filters?: Record<string, unknown>): OpsIncidentRecord[];
  listSnapshots(filters?: Record<string, unknown>): OpsSnapshotRecord[];
};
const createCapstanOpsRuntime = opsApi.createCapstanOpsRuntime as (options: {
  store: InstanceType<typeof InMemoryOpsStore>;
  serviceName?: string;
  environment?: string;
  incidentDedupeStatuses?: Array<"open" | "acknowledged" | "suppressed" | "resolved">;
}) => {
  recordEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>;
  recordIncident(incident: OpsIncidentRecord): Promise<OpsIncidentRecord>;
  captureSnapshot(snapshot: OpsSnapshotRecord): Promise<OpsSnapshotRecord>;
  captureDerivedSnapshot(timestamp?: string): Promise<OpsSnapshotRecord>;
  createOverview(): {
    totals: { events: number; incidents: number; snapshots: number };
    incidents: { open: number; acknowledged: number; suppressed: number; resolved: number };
    health: { status: string; summary: string; signals: unknown[] };
    windows: { recentEvents: Record<string, unknown>[]; recentIncidents: OpsIncidentRecord[]; recentSnapshots: OpsSnapshotRecord[] };
  };
  recordRecoveryFromEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>;
};

function event(
  id: string,
  timestamp: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: overrides.kind ?? "http.request",
    timestamp,
    severity: overrides.severity ?? "info",
    status: overrides.status ?? "ok",
    target: overrides.target ?? "runtime",
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
    kind: overrides.kind ?? "http.response",
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

describe("ops runtime extra", () => {
  it("merges repeated incidents and resolves them from a recovery event", async () => {
    const store = new InMemoryOpsStore();
    const runtime = createCapstanOpsRuntime({
      store,
      serviceName: "ops-runtime",
      environment: "development",
    });

    const first = await runtime.recordIncident(
      incident("inc-1", "policy:blocked:deny", "2026-04-04T00:00:01.000Z", {
        severity: "warning",
        status: "open",
        target: "policy",
        title: "policy blocked",
        summary: "policy blocked",
        metadata: { attempts: 1, note: "first" },
        observations: 1,
      }),
    );

    const merged = await runtime.recordIncident(
      incident("inc-2", "policy:blocked:deny", "2026-04-04T00:00:02.000Z", {
        severity: "error",
        status: "acknowledged",
        target: "policy",
        title: "policy blocked again",
        summary: "policy blocked again",
        metadata: { attempts: 2, note: "second" },
        observations: 1,
      }),
    );

    expect(merged.id).toBe(first.id);
    expect(merged.observations).toBe(2);
    expect(merged.severity).toBe("error");
    expect(merged.status).toBe("open");
    expect(merged.metadata.attempts).toBe(2);
    expect(merged.metadata.note).toBe("second");
    expect(merged.scope.service).toBe("ops-runtime");
    expect(merged.scope.environment).toBe("development");

    const recoveryEvent = await runtime.recordRecoveryFromEvent(
      event("evt-recovery", "2026-04-04T00:00:03.000Z", {
        kind: "policy",
        phase: "decision",
        severity: "info",
        status: "resolved",
        target: "policy",
        fingerprint: "policy:blocked:deny",
        summary: "policy recovered",
        metadata: { recovered: true },
      }),
    );

    expect(recoveryEvent.id).toBeDefined();

    const resolved = store.getIncidentByFingerprint("policy:blocked:deny");
    expect(resolved).toBeDefined();
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt).toBe("2026-04-04T00:00:03.000Z");
    expect(resolved?.lastSeenAt).toBe("2026-04-04T00:00:03.000Z");
    expect(resolved?.metadata.recoveryEventId).toBe(recoveryEvent.id);
  });

  it("derives snapshots and overview health from recent warnings and incidents", async () => {
    const store = new InMemoryOpsStore();
    const runtime = createCapstanOpsRuntime({
      store,
      serviceName: "ops-runtime",
      environment: "development",
    });

    await runtime.recordEvent(
      event("evt-warning", "2026-04-04T00:00:01.000Z", {
        kind: "http.request",
        severity: "warning",
        status: "warn",
        target: "runtime",
        summary: "warning request",
      }),
    );
    await runtime.recordEvent(
      event("evt-error", "2026-04-04T00:00:02.000Z", {
        kind: "capability",
        severity: "error",
        status: "error",
        target: "capability",
        summary: "capability failed",
      }),
    );
    await runtime.captureSnapshot(
      snapshot("snap-existing", "2026-04-04T00:00:02.500Z", "degraded", {
        summary: "existing snapshot",
        signals: [
          {
            key: "signal:existing",
            source: "snapshot",
            severity: "warning",
            status: "degraded",
            title: "existing",
            summary: "existing snapshot",
          },
        ],
      }),
    );

    const derived = await runtime.captureDerivedSnapshot("2026-04-04T00:00:04.000Z");
    const overview = runtime.createOverview();

    expect(derived.health).toBe("unhealthy");
    expect(derived.timestamp).toBe("2026-04-04T00:00:04.000Z");
    expect(derived.signals.length).toBeGreaterThanOrEqual(1);
    expect(overview.totals.events).toBeGreaterThanOrEqual(2);
    expect(overview.totals.snapshots).toBe(2);
    expect(overview.health.status).toBe("unhealthy");
    expect(overview.windows.recentSnapshots.at(-1)?.id).toBe(derived.id);
  });
});
