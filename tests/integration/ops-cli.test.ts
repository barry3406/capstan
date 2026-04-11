import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
let projectDir: string;
let projectDirRealPath: string;

async function runCli(
  args: string[],
  expectedExitCode = 0,
  cwd = projectDir,
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

async function writeOpsFixture(options: {
  events: unknown[];
  incidents: unknown[];
  health?: unknown;
}): Promise<void> {
  const storeDir = join(projectDir, ".capstan", "ops");
  await mkdir(storeDir, { recursive: true });

  await writeFile(
    join(storeDir, "ops.json"),
    JSON.stringify(
      {
        generatedAt: "2026-04-04T12:00:00.000Z",
        events: options.events,
        incidents: options.incidents,
        ...(options.health ? { health: options.health } : {}),
      },
      null,
      2,
    ),
    "utf-8",
  );
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

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "capstan-ops-cli-"));
  projectDir = join(tempDir, "ops-app");
  await createProjectSkeleton(projectDir, "Ops App");
  projectDirRealPath = await realpath(projectDir);

  await writeOpsFixture({
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
        kind: "approval",
        status: "required",
        summary: "Approval requested for deploy",
        severity: "warning",
        approvalId: "approval-1",
      },
      {
        id: "event-3",
        timestamp: "2026-04-04T12:00:00.000Z",
        kind: "release",
        status: "failed",
        summary: "Deploy verify failed",
        severity: "error",
        releaseId: "release-1",
      },
    ],
    incidents: [
      {
        id: "incident-1",
        timestamp: "2026-04-04T11:30:00.000Z",
        status: "open",
        severity: "critical",
        fingerprint: "deploy:vercel-edge",
        summary: "Edge deploy blocked by node-only imports",
        message: "Remove node: imports or switch target.",
      },
      {
        id: "incident-2",
        timestamp: "2026-04-04T09:45:00.000Z",
        status: "resolved",
        severity: "warning",
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
      criticalIncidents: 1,
      warningIncidents: 1,
      lastEventAt: "2026-04-04T12:00:00.000Z",
      lastIncidentAt: "2026-04-04T11:30:00.000Z",
      issues: [
        {
          severity: "error",
          code: "deploy:vercel-edge",
          summary: "Edge deploy blocked by node-only imports",
          detail: "Remove node: imports or switch target.",
        },
      ],
    },
  });
});

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("ops cli", () => {
  it("renders structured event, incident, health, and tail output from the default project root", async () => {
    const events = await runCli(["ops:events", "--json", "--limit", "2"]);
    const incidents = await runCli(["ops:incidents", "--json"]);
    const health = await runCli(["ops:health", "--json"]);
    const tail = await runCli(["ops:tail", "--limit", "2"]);

    const eventsReport = JSON.parse(events.stdout) as {
      appRoot: string;
      total: number;
      events: Array<{ id: string; kind: string; timestamp: string; summary?: string }>;
    };
    const incidentsReport = JSON.parse(incidents.stdout) as {
      total: number;
      incidents: Array<{ id: string; status: string; severity?: string }>;
    };
    const healthReport = JSON.parse(health.stdout) as {
      health: {
        status: string;
        openIncidents: number;
        criticalIncidents: number;
        issues: Array<{ code: string }>;
      };
    };

    expect(eventsReport.appRoot).toBe(projectDirRealPath);
    expect(eventsReport.total).toBe(2);
    expect(eventsReport.events.map((event) => event.id)).toEqual(["event-3", "event-2"]);
    expect(eventsReport.events[0]?.kind).toBe("release");

    expect(incidentsReport.total).toBe(2);
    expect(incidentsReport.incidents[0]?.status).toBe("open");
    expect(incidentsReport.incidents[0]?.severity).toBe("critical");

    expect(healthReport.health.status).toBe("unhealthy");
    expect(healthReport.health.openIncidents).toBe(1);
    expect(healthReport.health.criticalIncidents).toBe(1);
    expect(healthReport.health.issues.map((issue) => issue.code)).toContain("deploy:vercel-edge");

    expect(tail.stdout).toContain("Capstan Ops Tail");
    expect(tail.stdout).toContain("Deploy verify failed");
    expect(tail.stdout).toContain("Edge deploy blocked by node-only imports");
  });

  it("derives health from JSONL store files when no aggregate snapshot exists", async () => {
    const jsonlProject = join(tempDir, "ops-jsonl-app");
    await createProjectSkeleton(jsonlProject, "Ops JSONL App");

    const storeDir = join(jsonlProject, ".capstan", "ops");
    await mkdir(storeDir, { recursive: true });
    await writeFile(
      join(storeDir, "events.jsonl"),
      [
        JSON.stringify({
          id: "event-a",
          timestamp: "2026-04-04T08:00:00.000Z",
          kind: "request",
          status: "ok",
          summary: "GET /health",
        }),
        JSON.stringify({
          id: "event-b",
          timestamp: "2026-04-04T09:00:00.000Z",
          kind: "policy",
          status: "deny",
          summary: "Policy denied write request",
          severity: "warning",
        }),
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      join(storeDir, "incidents.jsonl"),
      [
        JSON.stringify({
          id: "incident-a",
          timestamp: "2026-04-04T09:10:00.000Z",
          status: "open",
          severity: "error",
          fingerprint: "sqlite-edge",
          summary: "SQLite blocked on edge target",
        }),
      ].join("\n"),
      "utf-8",
    );

    const healthResult = await spawn(process.execPath, [capstanCliEntry, "ops:health", "--json"], {
      cwd: jsonlProject,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    healthResult.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
    healthResult.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
    const [code] = await once(healthResult, "exit") as [number | null];
    if (code !== 0) {
      throw new Error(`ops:health --json failed\nSTDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`);
    }

    const report = JSON.parse(stdout.join("")) as {
      health: { status: string; events: number; incidents: number; openIncidents: number };
    };

    expect(report.health.status).toBe("unhealthy");
    expect(report.health.events).toBe(2);
    expect(report.health.incidents).toBe(1);
    expect(report.health.openIncidents).toBe(1);
  });

  it("reads ops events, incidents, and health from the package-backed sqlite store", async () => {
    const sqliteProject = join(tempDir, "ops-sqlite-app");
    await createProjectSkeleton(sqliteProject, "Ops SQLite App");

    const dbPath = join(sqliteProject, ".capstan", "ops", "ops.db");
    await mkdir(join(sqliteProject, ".capstan", "ops"), { recursive: true });
    const store = new SqliteOpsStore({ path: dbPath });
    const runtime = createCapstanOpsRuntime({
      store,
      serviceName: "ops-sqlite-app",
    });

    await runtime.recordEvent({
      id: "event-sqlite-1",
      kind: "http.request",
      severity: "critical",
      status: "error",
      target: "runtime",
      scope: { app: "ops-sqlite-app", route: "/api/broken", traceId: "trace-sqlite-1" },
      tags: ["runtime", "sqlite"],
      metadata: { origin: "sqlite-fixture" },
      timestamp: "2026-04-04T10:15:00.000Z",
      summary: "GET /api/broken",
      message: "Broken route returned 500",
      fingerprint: "http:/api/broken:500",
    });
    await runtime.captureSnapshot({
      timestamp: "2026-04-04T10:16:00.000Z",
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

    const events = await runCli(["ops:events", "--json", "--limit", "1"], 0, sqliteProject);
    const incidents = await runCli(["ops:incidents", "--json", "--limit", "1"], 0, sqliteProject);
    const health = await runCli(["ops:health", "--json"], 0, sqliteProject);

    const eventsReport = JSON.parse(events.stdout) as {
      source: string;
      total: number;
      events: Array<{ id: string; kind: string; summary?: string; source?: string }>;
    };
    const incidentsReport = JSON.parse(incidents.stdout) as {
      source: string;
      total: number;
      incidents: Array<{ fingerprint: string; status: string; severity?: string }>;
    };
    const healthReport = JSON.parse(health.stdout) as {
      source: string;
      health: { status: string; summary: string; events: number; incidents: number; issues: Array<{ code: string }> };
    };

    expect(eventsReport.source).toBe("package");
    expect(eventsReport.total).toBe(1);
    expect(eventsReport.events[0]?.kind).toBe("http.request");
    expect(eventsReport.events[0]?.summary).toBe("GET /api/broken");

    expect(incidentsReport.source).toBe("package");
    expect(incidentsReport.total).toBe(1);
    expect(incidentsReport.incidents[0]?.fingerprint).toBe("http:/api/broken:500");
    expect(incidentsReport.incidents[0]?.status).toBe("open");

    expect(healthReport.source).toBe("package");
    expect(healthReport.health.status).toBe("unhealthy");
    expect(healthReport.health.events).toBe(1);
    expect(healthReport.health.incidents).toBe(1);
    expect(healthReport.health.issues.map((issue) => issue.code)).toContain("signal:sqlite");
  });
});
