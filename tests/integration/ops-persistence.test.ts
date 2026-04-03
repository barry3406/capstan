import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  InMemoryOpsStore,
  SqliteOpsStore,
  createCapstanOpsRuntime,
} from "../../packages/ops/src/index.ts";

async function tempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "capstan-ops-persist-"));
  return join(root, "ops.sqlite");
}

describe("ops persistence integration", () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    for (const filePath of cleanup.splice(0)) {
      try {
        await rm(filePath, { force: true, recursive: true });
      } catch {
        // Ignore temp cleanup errors.
      }
    }
  });

  it("persists runtime events, incidents, and snapshots across process boundaries", async () => {
    const path = await tempDbPath();
    cleanup.push(path, path.replace(/\.sqlite$/, ""));

    const first = new SqliteOpsStore({ path });
    const runtime = createCapstanOpsRuntime({
      store: first,
      serviceName: "capstan-test",
    });

    await runtime.recordEvent({
      kind: "http.request",
      severity: "info",
      status: "ok",
      target: "runtime",
      scope: { app: "alpha" },
      tags: ["runtime"],
      metadata: {},
      timestamp: "2026-04-04T00:00:01.000Z",
    });
    await runtime.recordIncident({
      fingerprint: "release:missing-env",
      kind: "release.verify",
      severity: "warning",
      status: "open",
      title: "missing env",
      summary: "missing env",
      scope: { app: "alpha" },
      metadata: {},
      timestamp: "2026-04-04T00:00:02.000Z",
    });
    await runtime.captureSnapshot({
      timestamp: "2026-04-04T00:00:03.000Z",
      health: "degraded",
      summary: "release warnings",
      signals: [],
    });
    await first.close();

    const reopened = new SqliteOpsStore({ path });
    const events = await reopened.listEvents();
    const incidents = await reopened.listIncidents();
    const snapshots = await reopened.listSnapshots();

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("http.request");
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.fingerprint).toBe("release:missing-env");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.health).toBe("degraded");
    await reopened.close();
  });

  it("keeps incident dedupe stable when repeated signals are replayed", async () => {
    const runtime = createCapstanOpsRuntime({
      store: new InMemoryOpsStore(),
      serviceName: "capstan-test",
    });

    const first = await runtime.recordIncident({
      fingerprint: "policy:deny-route",
      kind: "policy.deny",
      severity: "critical",
      status: "open",
      title: "policy denied",
      summary: "policy denied",
      scope: { app: "alpha" },
      metadata: { route: "/admin" },
      timestamp: "2026-04-04T00:00:01.000Z",
    });

    const second = await runtime.recordIncident({
      fingerprint: "policy:deny-route",
      kind: "policy.deny",
      severity: "critical",
      status: "open",
      title: "policy denied",
      summary: "policy denied",
      scope: { app: "alpha" },
      metadata: { route: "/admin" },
      timestamp: "2026-04-04T00:00:02.000Z",
    });

    expect(second.id).toBe(first.id);
    expect(second.observations).toBeGreaterThanOrEqual(2);
  });
});
