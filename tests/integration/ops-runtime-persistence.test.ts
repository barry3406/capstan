import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineAPI, definePolicy } from "@zauso-ai/capstan-core";
import type { RouteEntry, RouteManifest } from "@zauso-ai/capstan-router/runtime";

import * as ops from "../../packages/ops/src/index.ts";
import { buildPortableRuntimeApp } from "../../packages/dev/src/runtime.ts";

const opsApi = ops as Record<string, unknown>;
const SqliteOpsStore = opsApi.SqliteCapstanOpsStore as new (options: {
  path: string;
}) => {
  listEvents(filters?: Record<string, unknown>): Array<{ kind: string; summary?: string; status?: string; timestamp: string }>;
  listIncidents(filters?: Record<string, unknown>): Array<{ fingerprint: string; status: string; summary: string }>;
  listSnapshots(filters?: Record<string, unknown>): Array<{ health: string; summary: string; timestamp: string }>;
  close(): Promise<void>;
};

function buildRoute(filePath: string, urlPattern: string): RouteEntry {
  return {
    filePath,
    type: "api",
    urlPattern,
    layouts: [],
    middlewares: [],
    params: [],
    isCatchAll: false,
  };
}

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (!root) {
      continue;
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe("ops runtime persistence", () => {
  it("persists portable runtime signals into the default project sqlite store", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "capstan-ops-runtime-store-"));
    tempRoots.push(rootDir);

    const okFile = `${rootDir}/app/routes/api/ok.api.ts`;
    const blockedFile = `${rootDir}/app/routes/api/blocked.api.ts`;

    const manifest: RouteManifest = {
      rootDir,
      scannedAt: "2026-04-04T00:00:00.000Z",
      routes: [
        buildRoute("app/routes/api/ok.api.ts", "/api/ok"),
        buildRoute("app/routes/api/blocked.api.ts", "/api/blocked"),
      ],
    };

    const blockedPolicy = definePolicy({
      key: "blocked",
      title: "Blocked",
      effect: "deny",
      async check() {
        return { effect: "deny", reason: "blocked at runtime" };
      },
    });

    const build = await buildPortableRuntimeApp({
      appName: "ops-runtime-store-test",
      rootDir,
      manifest,
      mode: "development",
      routeModules: {
        [okFile]: {
          GET: defineAPI({
            description: "OK route",
            capability: "read",
            resource: "runtime.ok",
            async handler() {
              return { ok: true };
            },
          }),
        },
        [blockedFile]: {
          GET: defineAPI({
            description: "Blocked route",
            capability: "read",
            resource: "runtime.blocked",
            policy: "blocked",
            async handler() {
              return { ok: true };
            },
          }),
        },
      },
      policyRegistry: new Map([[blockedPolicy.key, blockedPolicy]]),
    });

    const okResponse = await build.app.fetch(
      new Request("http://localhost/api/ok", {
        headers: {
          "X-Request-Id": "persist-request-ok",
          "X-Trace-Id": "persist-trace-ok",
        },
      }),
    );
    const blockedResponse = await build.app.fetch(
      new Request("http://localhost/api/blocked", {
        headers: {
          "X-Request-Id": "persist-request-blocked",
          "X-Trace-Id": "persist-trace-blocked",
        },
      }),
    );

    expect(okResponse.status).toBe(200);
    expect(blockedResponse.status).toBe(403);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const store = new SqliteOpsStore({
      path: join(rootDir, ".capstan", "ops", "ops.db"),
    });

    try {
      const events = store.listEvents({ sort: "desc" });
      const incidents = store.listIncidents({ sort: "desc" });
      const snapshots = store.listSnapshots({ sort: "desc" });

      expect(events.some((event) => event.kind === "request.end" && event.status === "error")).toBe(true);
      expect(events.some((event) => event.kind === "policy.decision" && event.summary?.includes("blocked"))).toBe(true);
      expect(incidents.some((incident) => incident.fingerprint === "policy:blocked:deny" && incident.status === "open")).toBe(true);
      expect(snapshots.length).toBeGreaterThan(0);
      expect(["healthy", "degraded", "unhealthy"]).toContain(snapshots[0]?.health);
    } finally {
      await store.close();
    }
  });
});
