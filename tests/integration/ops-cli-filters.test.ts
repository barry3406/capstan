import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as ops from "../../packages/ops/src/index.ts";

const opsApi = ops as Record<string, unknown>;
const SqliteOpsStore = opsApi.SqliteCapstanOpsStore as new (options: { path: string }) => {
  close(): Promise<void>;
  listEvents(filters?: Record<string, unknown>): Promise<Array<{ id: string; kind: string; timestamp: string; summary?: string; severity?: string; status?: string; source?: string }>>;
  listIncidents(filters?: Record<string, unknown>): Promise<Array<{ id: string; fingerprint: string; timestamp: string; summary?: string; severity?: string; status?: string; source?: string }>>;
  listSnapshots(filters?: Record<string, unknown>): Promise<Array<{ id: string; health: string; timestamp: string; summary: string; signals: unknown[] }>>;
};
const createCapstanOpsRuntime = opsApi.createCapstanOpsRuntime as (options: {
  store: InstanceType<typeof SqliteOpsStore>;
  serviceName: string;
}) => {
  recordEvent(event: Record<string, unknown>): Promise<void>;
  recordIncident(incident: Record<string, unknown>): Promise<{ id: string; observations?: number }>;
  captureSnapshot(snapshot: Record<string, unknown>): Promise<void>;
};

const repoRoot = process.cwd();
const capstanCliEntry = join(repoRoot, "packages", "cli", "src", "index.ts");
const rootNodeModules = join(repoRoot, "node_modules");

let tempDir: string;
let explicitProjectDir: string;
let emptyProjectDir: string;
let sqliteProjectDir: string;
let explicitProjectRealPath: string;
let sqliteProjectRealPath: string;

async function runCli(
  args: string[],
  expectedExitCode = 0,
  cwd = repoRoot,
): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [capstanCliEntry, ...args], {
    cwd,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  if (code !== expectedExitCode) {
    throw new Error(
      `capstan ${args.join(" ")} failed with code ${code}${signal ? ` signal ${signal}` : ""}\n` +
      `STDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
    );
  }

  return {
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

async function createProjectSkeleton(rootDir: string, name: string): Promise<void> {
  await mkdir(join(rootDir, "app", "routes"), { recursive: true });
  await writeFile(
    join(rootDir, "app", "routes", "index.page.tsx"),
    `export default function IndexPage() { return <main><h1>${name}</h1></main>; }`,
    "utf-8",
  );
  await writeFile(
    join(rootDir, "capstan.config.ts"),
    `export default { app: { name: ${JSON.stringify(name)} } };`,
    "utf-8",
  );
  await symlink(rootNodeModules, join(rootDir, "node_modules"), "dir");
}

async function writeJsonOpsFixture(rootDir: string): Promise<void> {
  const storeDir = join(rootDir, ".capstan", "ops");
  await mkdir(storeDir, { recursive: true });
  await writeFile(
    join(storeDir, "ops.json"),
    JSON.stringify(
      {
        generatedAt: "2026-04-04T12:00:00.000Z",
        events: [
          {
            id: "event-1",
            timestamp: "2026-04-04T10:00:00.000Z",
            kind: "request",
            status: "start",
            summary: "GET /health",
            severity: "info",
            requestId: "req-1",
          },
          {
            id: "event-2",
            timestamp: "2026-04-04T11:00:00.000Z",
            kind: "request",
            status: "error",
            summary: "GET /broken",
            severity: "error",
            requestId: "req-2",
          },
          {
            id: "event-3",
            timestamp: "2026-04-04T12:00:00.000Z",
            kind: "policy",
            status: "deny",
            summary: "Policy denied write request",
            severity: "warning",
          },
        ],
        incidents: [
          {
            id: "incident-1",
            timestamp: "2026-04-04T11:30:00.000Z",
            status: "open",
            severity: "warning",
            fingerprint: "deploy:vercel-edge",
            summary: "Edge deploy blocked by node-only imports",
          },
          {
            id: "incident-2",
            timestamp: "2026-04-04T09:45:00.000Z",
            status: "resolved",
            severity: "critical",
            fingerprint: "ops:health",
            summary: "Health snapshot recovered",
          },
        ],
        health: {
          status: "degraded",
          summary: "One open incident remains.",
          generatedAt: "2026-04-04T12:01:00.000Z",
          events: 3,
          incidents: 2,
          openIncidents: 1,
          criticalIncidents: 0,
          warningIncidents: 1,
          lastEventAt: "2026-04-04T12:00:00.000Z",
          lastIncidentAt: "2026-04-04T11:30:00.000Z",
          issues: [
            {
              severity: "warning",
              code: "deploy:vercel-edge",
              summary: "Edge deploy blocked by node-only imports",
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

async function writeSqliteOpsFixture(rootDir: string): Promise<void> {
  const storeDir = join(rootDir, ".capstan", "ops");
  await mkdir(storeDir, { recursive: true });
  const store = new SqliteOpsStore({ path: join(storeDir, "ops.db") });
  const runtime = createCapstanOpsRuntime({
    store,
    serviceName: "ops-sqlite-cli-test",
  });

  await runtime.recordEvent({
    id: "event-sqlite-1",
    kind: "http.request",
    severity: "critical",
    status: "error",
    target: "runtime",
    scope: { app: "ops-sqlite-cli-test", route: "/api/broken", traceId: "trace-sqlite-1" },
    tags: ["runtime", "sqlite"],
    metadata: { origin: "sqlite-fixture" },
    timestamp: "2026-04-04T10:15:00.000Z",
    summary: "GET /api/broken",
    message: "Broken route returned 500",
    fingerprint: "http:/api/broken:500",
  });
  await runtime.recordIncident({
    id: "incident-sqlite-1",
    fingerprint: "deploy:sqlite-edge",
    kind: "release.verify",
    timestamp: "2026-04-04T10:16:00.000Z",
    severity: "warning",
    status: "open",
    title: "SQLite edge warning",
    summary: "SQLite store reports a warning condition.",
    scope: { app: "ops-sqlite-cli-test" },
    metadata: { origin: "sqlite-fixture" },
  });
  await runtime.recordIncident({
    id: "incident-sqlite-2",
    fingerprint: "deploy:sqlite-edge-resolved",
    kind: "release.verify",
    timestamp: "2026-04-04T10:17:00.000Z",
    severity: "critical",
    status: "resolved",
    title: "SQLite edge recovered",
    summary: "SQLite edge issue has been resolved.",
    scope: { app: "ops-sqlite-cli-test" },
    metadata: { origin: "sqlite-fixture" },
  });
  await runtime.captureSnapshot({
    timestamp: "2026-04-04T10:18:00.000Z",
    health: "unhealthy",
    summary: "SQLite store reports an unhealthy runtime.",
    signals: [
      {
        key: "signal:sqlite",
        source: "snapshot",
        severity: "error",
        status: "unhealthy",
        title: "SQLite store",
        summary: "SQLite store reports an unhealthy runtime.",
      },
    ],
  });
  await store.close();
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "capstan-ops-cli-filters-"));

  explicitProjectDir = join(tempDir, "ops-json-app");
  await createProjectSkeleton(explicitProjectDir, "Ops JSON App");
  await writeJsonOpsFixture(explicitProjectDir);
  explicitProjectRealPath = await realpath(explicitProjectDir);

  emptyProjectDir = join(tempDir, "ops-empty-app");
  await createProjectSkeleton(emptyProjectDir, "Ops Empty App");

  sqliteProjectDir = join(tempDir, "ops-sqlite-app");
  await createProjectSkeleton(sqliteProjectDir, "Ops SQLite App");
  await writeSqliteOpsFixture(sqliteProjectDir);
  sqliteProjectRealPath = await realpath(sqliteProjectDir);
});

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("ops cli filters", () => {
  it("filters JSON-backed events and incidents through explicit --path and --root aliases", async () => {
    const eventsViaPath = await runCli(
      ["ops:events", "--json", "--kind", "request", "--since", "2026-04-04T10:30:00.000Z", "--path", "ops-json-app"],
      0,
      tempDir,
    );
    const incidentsViaRoot = await runCli(
      ["ops:incidents", "--json", "--status", "open", "--severity", "warning", "--root", "ops-json-app"],
      0,
      tempDir,
    );
    const health = await runCli(["ops:health", "--json", "--path", "ops-json-app"], 0, tempDir);
    const tail = await runCli(["ops:tail", "--json", "--follow", "--limit", "2", "--root", "ops-json-app"], 0, tempDir);

    const eventsReport = JSON.parse(eventsViaPath.stdout) as {
      appRoot: string;
      source: string;
      total: number;
      events: Array<{ id: string; kind: string; timestamp: string; status?: string; severity?: string }>;
    };
    const incidentsReport = JSON.parse(incidentsViaRoot.stdout) as {
      appRoot: string;
      source: string;
      total: number;
      incidents: Array<{ id: string; status: string; severity?: string; fingerprint?: string }>;
    };
    const healthReport = JSON.parse(health.stdout) as {
      appRoot: string;
      source: string;
      health: { status: string; openIncidents: number; criticalIncidents: number; warningIncidents: number; issues: Array<{ code: string }> };
    };
    const tailReport = JSON.parse(tail.stdout) as {
      appRoot: string;
      source: string;
      total: number;
      follow: boolean;
      feed: Array<{ kind: string; id: string; timestamp: string; summary: string; severity?: string; status?: string }>;
    };

    expect(eventsReport.appRoot).toBe(explicitProjectRealPath);
    expect(eventsReport.source).toBe("filesystem");
    expect(eventsReport.total).toBe(1);
    expect(eventsReport.events.map((event) => event.id)).toEqual(["event-2"]);
    expect(eventsReport.events[0]?.kind).toBe("request");
    expect(eventsReport.events[0]?.severity).toBe("error");

    expect(incidentsReport.appRoot).toBe(explicitProjectRealPath);
    expect(incidentsReport.source).toBe("filesystem");
    expect(incidentsReport.total).toBe(1);
    expect(incidentsReport.incidents[0]?.id).toBe("incident-1");
    expect(incidentsReport.incidents[0]?.status).toBe("open");
    expect(incidentsReport.incidents[0]?.severity).toBe("warning");

    expect(healthReport.appRoot).toBe(explicitProjectRealPath);
    expect(healthReport.source).toBe("filesystem");
    expect(healthReport.health.status).toBe("degraded");
    expect(healthReport.health.openIncidents).toBe(1);
    expect(healthReport.health.warningIncidents).toBe(1);
    expect(healthReport.health.issues.map((issue) => issue.code)).toContain("deploy:vercel-edge");

    expect(tailReport.appRoot).toBe(explicitProjectRealPath);
    expect(tailReport.source).toBe("filesystem");
    expect(tailReport.follow).toBe(true);
    expect(tailReport.total).toBe(2);
    expect(tailReport.feed.map((entry) => entry.kind)).toEqual(["event", "incident"]);
    expect(tailReport.feed[0]?.id).toBe("event-3");
    expect(tailReport.feed[1]?.id).toBe("incident-1");
  });

  it("keeps empty stores stable across events, incidents, health, and tail projections", async () => {
    const events = await runCli(["ops:events", "--json", "--path", "ops-empty-app"], 0, tempDir);
    const incidents = await runCli(["ops:incidents", "--json", "--root", "ops-empty-app"], 0, tempDir);
    const health = await runCli(["ops:health", "--json", "--path", "ops-empty-app"], 0, tempDir);
    const tail = await runCli(["ops:tail", "--json", "--limit", "3", "--root", "ops-empty-app"], 0, tempDir);

    const eventsReport = JSON.parse(events.stdout) as {
      source: string;
      total: number;
      events: unknown[];
    };
    const incidentsReport = JSON.parse(incidents.stdout) as {
      source: string;
      total: number;
      incidents: unknown[];
    };
    const healthReport = JSON.parse(health.stdout) as {
      source: string;
      health: { status: string; events: number; incidents: number; openIncidents: number; issues: unknown[] };
    };
    const tailReport = JSON.parse(tail.stdout) as {
      source: string;
      total: number;
      follow: boolean;
      feed: unknown[];
    };

    expect(eventsReport.source).toBe("filesystem");
    expect(eventsReport.total).toBe(0);
    expect(eventsReport.events).toEqual([]);

    expect(incidentsReport.source).toBe("filesystem");
    expect(incidentsReport.total).toBe(0);
    expect(incidentsReport.incidents).toEqual([]);

    expect(healthReport.source).toBe("filesystem");
    expect(healthReport.health.status).toBe("healthy");
    expect(healthReport.health.events).toBe(0);
    expect(healthReport.health.incidents).toBe(0);
    expect(healthReport.health.openIncidents).toBe(0);
    expect(healthReport.health.issues).toEqual([]);

    expect(tailReport.source).toBe("filesystem");
    expect(tailReport.total).toBe(0);
    expect(tailReport.follow).toBe(false);
    expect(tailReport.feed).toEqual([]);
  });

  it("filters package-backed sqlite events and incidents and preserves follow projection", async () => {
    const events = await runCli(
      ["ops:events", "--json", "--kind", "http.request", "--severity", "critical", "--path", "ops-sqlite-app"],
      0,
      tempDir,
    );
    const incidents = await runCli(
      ["ops:incidents", "--json", "--status", "open", "--severity", "warning", "--root", "ops-sqlite-app"],
      0,
      tempDir,
    );
    const health = await runCli(["ops:health", "--json", "--path", "ops-sqlite-app"], 0, tempDir);
    const tail = await runCli(["ops:tail", "--json", "--follow", "--limit", "2", "--root", "ops-sqlite-app"], 0, tempDir);

    const eventsReport = JSON.parse(events.stdout) as {
      appRoot: string;
      source: string;
      total: number;
      events: Array<{ id: string; kind: string; timestamp: string; severity?: string; status?: string; summary?: string; source?: string }>;
    };
    const incidentsReport = JSON.parse(incidents.stdout) as {
      appRoot: string;
      source: string;
      total: number;
      incidents: Array<{ id: string; fingerprint: string; timestamp: string; severity?: string; status?: string; summary?: string; source?: string }>;
    };
    const healthReport = JSON.parse(health.stdout) as {
      appRoot: string;
      source: string;
      health: { status: string; events: number; incidents: number; openIncidents: number; criticalIncidents: number; issues: Array<{ code: string }> };
    };
    const tailReport = JSON.parse(tail.stdout) as {
      appRoot: string;
      source: string;
      follow: boolean;
      total: number;
      feed: Array<{ kind: string; id: string; severity?: string; status?: string; summary: string }>;
    };

    expect(eventsReport.appRoot).toBe(sqliteProjectRealPath);
    expect(eventsReport.source).toBe("package");
    expect(eventsReport.total).toBe(1);
    expect(eventsReport.events[0]?.id).toBe("event-sqlite-1");
    expect(eventsReport.events[0]?.kind).toBe("http.request");
    expect(eventsReport.events[0]?.severity).toBe("critical");
    expect(eventsReport.events[0]?.status).toBe("error");

    expect(incidentsReport.appRoot).toBe(sqliteProjectRealPath);
    expect(incidentsReport.source).toBe("package");
    expect(incidentsReport.total).toBe(1);
    expect(incidentsReport.incidents[0]?.fingerprint).toBe("deploy:sqlite-edge");
    expect(incidentsReport.incidents[0]?.status).toBe("open");
    expect(incidentsReport.incidents[0]?.severity).toBe("warning");

    expect(healthReport.appRoot).toBe(sqliteProjectRealPath);
    expect(healthReport.source).toBe("package");
    expect(healthReport.health.status).toBe("unhealthy");
    expect(healthReport.health.events).toBe(1);
    expect(healthReport.health.incidents).toBe(3);
    expect(healthReport.health.openIncidents).toBe(2);
    expect(healthReport.health.criticalIncidents).toBe(2);
    expect(healthReport.health.warningIncidents).toBe(1);
    expect(healthReport.health.issues.map((issue) => issue.code)).toContain("signal:sqlite");

    expect(tailReport.appRoot).toBe(sqliteProjectRealPath);
    expect(tailReport.source).toBe("package");
    expect(tailReport.follow).toBe(true);
    expect(tailReport.total).toBe(2);
    expect(tailReport.feed.map((entry) => entry.kind)).toEqual(["incident", "incident"]);
  });
});
