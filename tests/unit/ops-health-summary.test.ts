import { describe, expect, it } from "bun:test";

import {
  summarizeOpsHealth,
  type OpsSnapshot,
} from "../../packages/cli/src/ops.ts";

describe("ops health summary", () => {
  it("elevates a stale healthy snapshot when current incidents are critical", () => {
    const snapshot: OpsSnapshot = {
      appRoot: "/tmp/capstan-app",
      storeDir: "/tmp/capstan-app/.capstan/ops",
      generatedAt: "2026-04-04T00:00:05.000Z",
      source: "package",
      events: [
        {
          id: "evt-1",
          timestamp: "2026-04-04T00:00:04.000Z",
          kind: "request.end",
          status: "error",
          severity: "error",
          summary: "GET /api/broken returned 500",
        },
      ],
      incidents: [
        {
          id: "inc-1",
          timestamp: "2026-04-04T00:00:04.500Z",
          status: "open",
          severity: "critical",
          fingerprint: "request:GET:/api/broken:5xx",
          summary: "Broken route is still failing",
        },
      ],
      health: {
        status: "healthy",
        summary: "Snapshot was healthy before the latest failure.",
        generatedAt: "2026-04-04T00:00:03.000Z",
        events: 0,
        incidents: 0,
        openIncidents: 0,
        criticalIncidents: 0,
        warningIncidents: 0,
        issues: [],
      },
    };

    const health = summarizeOpsHealth(snapshot);

    expect(health.status).toBe("unhealthy");
    expect(health.openIncidents).toBe(1);
    expect(health.criticalIncidents).toBe(1);
    expect(health.issues.map((issue) => issue.code)).toContain("request:GET:/api/broken:5xx");
    expect(health.lastIncidentAt).toBe("2026-04-04T00:00:04.500Z");
  });

  it("elevates a stale healthy snapshot to degraded when only warning incidents remain", () => {
    const snapshot: OpsSnapshot = {
      appRoot: "/tmp/capstan-app",
      storeDir: "/tmp/capstan-app/.capstan/ops",
      generatedAt: "2026-04-04T00:00:05.000Z",
      source: "package",
      events: [],
      incidents: [
        {
          id: "inc-2",
          timestamp: "2026-04-04T00:00:04.000Z",
          status: "open",
          severity: "warning",
          fingerprint: "policy:needs-approval:approve",
          summary: "Approval queue still has pending work",
        },
      ],
      health: {
        status: "healthy",
        summary: "No incidents yet.",
        generatedAt: "2026-04-04T00:00:03.000Z",
        events: 0,
        incidents: 0,
        openIncidents: 0,
        criticalIncidents: 0,
        warningIncidents: 0,
        issues: [],
      },
    };

    const health = summarizeOpsHealth(snapshot);

    expect(health.status).toBe("degraded");
    expect(health.warningIncidents).toBe(1);
    expect(health.issues[0]?.code).toBe("policy:needs-approval:approve");
  });
});
