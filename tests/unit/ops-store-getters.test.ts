import { describe, expect, it } from "bun:test";

import * as ops from "../../packages/ops/src/index.ts";

type OpsEventRecord = typeof import("../../packages/ops/src/index.ts").OpsEventRecord;
type OpsIncidentRecord = typeof import("../../packages/ops/src/index.ts").OpsIncidentRecord;

const opsApi = ops as Record<string, unknown>;
const InMemoryOpsStore = opsApi.InMemoryCapstanOpsStore as new (options?: {
  retention?: {
    events?: { maxAgeMs?: number };
    incidents?: { maxAgeMs?: number };
  };
}) => {
  addEvent(event: OpsEventRecord): OpsEventRecord;
  getEvent(id: string): OpsEventRecord | undefined;
  addIncident(incident: OpsIncidentRecord): OpsIncidentRecord;
  getIncident(id: string): OpsIncidentRecord | undefined;
  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined;
};

function withFixedTime<T>(iso: string, run: () => T): T {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: any[]) {
      super(...(args.length === 0 ? [iso] : args));
    }

    static now(): number {
      return new RealDate(iso).getTime();
    }

    static parse(value: string): number {
      return RealDate.parse(value);
    }

    static UTC(...args: Parameters<typeof RealDate.UTC>): number {
      return RealDate.UTC(...args);
    }
  }

  globalThis.Date = FixedDate as DateConstructor;
  try {
    return run();
  } finally {
    globalThis.Date = RealDate;
  }
}

function event(
  id: string,
  timestamp: string,
  overrides: Partial<OpsEventRecord> = {},
): OpsEventRecord {
  return {
    id,
    kind: overrides.kind ?? "http.request",
    timestamp,
    severity: overrides.severity ?? "info",
    status: overrides.status ?? "ok",
    target: overrides.target ?? "runtime",
    scope: overrides.scope ?? { app: "ops-getters" },
    tags: overrides.tags ?? ["ops"],
    metadata: overrides.metadata ?? {},
    ...(overrides.summary ? { summary: overrides.summary } : {}),
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
    target: overrides.target ?? "runtime",
    scope: overrides.scope ?? { app: "ops-getters" },
    tags: overrides.tags ?? ["ops"],
    metadata: overrides.metadata ?? {},
  };
}

describe("ops store getters", () => {
  it("does not return expired events from direct getters once retention would prune them", () => {
    const store = new InMemoryOpsStore({
      retention: {
        events: { maxAgeMs: 1000 },
      },
    });

    store.addEvent(event("evt-old", "2026-04-04T00:00:00.000Z"));
    store.addEvent(event("evt-fresh", "2026-04-04T00:00:01.200Z", {
      kind: "http.response",
      status: "ok",
    }));

    withFixedTime("2026-04-04T00:00:02.000Z", () => {
      expect(store.getEvent("evt-old")).toBeUndefined();
      expect(store.getEvent("evt-fresh")).toBeDefined();
    });
  });

  it("does not return expired incidents from id and fingerprint lookups after retention cutoff", () => {
    const store = new InMemoryOpsStore({
      retention: {
        incidents: { maxAgeMs: 1000 },
      },
    });

    store.addIncident(incident("inc-old", "runtime:old", "2026-04-04T00:00:00.000Z"));
    store.addIncident(incident("inc-fresh", "runtime:fresh", "2026-04-04T00:00:01.200Z", {
      severity: "critical",
      summary: "fresh incident",
    }));

    withFixedTime("2026-04-04T00:00:02.000Z", () => {
      expect(store.getIncident("inc-old")).toBeUndefined();
      expect(store.getIncidentByFingerprint("runtime:old")).toBeUndefined();
      expect(store.getIncident("inc-fresh")?.id).toBe("inc-fresh");
      expect(store.getIncidentByFingerprint("runtime:fresh")?.id).toBe("inc-fresh");
    });
  });
});
