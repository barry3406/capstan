import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { FileHarnessRuntimeStore } from "@zauso-ai/capstan-ai";
import type {
  AgentCheckpoint,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-store-faults-"));
  tempDirs.push(dir);
  return dir;
}

function buildSessionMemoryRecord(
  runId: string,
  overrides: Partial<HarnessSessionMemoryRecord> = {},
): HarnessSessionMemoryRecord {
  const now = new Date().toISOString();
  return {
    runId,
    goal: "fault coverage",
    status: "running",
    updatedAt: now,
    sourceRunUpdatedAt: now,
    headline: "runtime remains predictable",
    currentPhase: "reasoning",
    recentSteps: ["step-one"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    compactedMessages: 0,
    tokenEstimate: 12,
    ...overrides,
  };
}

function buildSummaryRecord(
  runId: string,
  overrides: Partial<HarnessSummaryRecord> = {},
): HarnessSummaryRecord {
  const now = new Date().toISOString();
  return {
    id: `summary_${runId}`,
    runId,
    createdAt: now,
    updatedAt: now,
    sourceRunUpdatedAt: now,
    kind: "run_compact",
    status: "completed",
    headline: "runtime remains predictable",
    completedSteps: ["did the thing"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    iterations: 2,
    toolCalls: 1,
    messageCount: 4,
    compactedMessages: 1,
    ...overrides,
  };
}

function buildCheckpoint(
  overrides: Partial<AgentCheckpoint> = {},
): AgentCheckpoint {
  return {
    stage: "tool_result",
    goal: "fault coverage",
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "goal" },
    ],
    iterations: 1,
    toolCalls: [],
    taskCalls: [],
    maxOutputTokens: 8192,
    compaction: {
      autocompactFailures: 0,
      reactiveCompactRetries: 0,
      tokenEscalations: 0,
    },
    ...overrides,
  };
}

describe("FileHarnessRuntimeStore context fault paths", () => {
  it("rejects invalid run ids across read APIs before touching disk", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await expect(store.getRun("../escape")).rejects.toThrow("Invalid harness run id");
    await expect(store.getCheckpoint("bad/run")).rejects.toThrow("Invalid harness run id");
    await expect(store.getSessionMemory("bad/run")).rejects.toThrow("Invalid harness run id");
    await expect(store.getLatestSummary("bad/run")).rejects.toThrow("Invalid harness run id");
    await expect(store.getEvents("../escape")).rejects.toThrow("Invalid harness run id");
  });

  it("rejects malformed checkpoint/session/summary payloads at write time", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await expect(
      store.persistCheckpoint("run-1", buildCheckpoint({ stage: "bogus" as never })),
    ).rejects.toThrow("unsupported stage");

    await expect(
      store.persistSessionMemory(
        buildSessionMemoryRecord("run-1", { recentSteps: ["ok"], goal: "   " }),
      ),
    ).rejects.toThrow("goal must be a non-empty string");

    await expect(
      store.persistSummary(
        buildSummaryRecord("run-1", { compactedMessages: -1 }),
      ),
    ).rejects.toThrow("compactedMessages must be a non-negative integer");
  });

  it("throws when a persisted checkpoint record is structurally invalid on disk", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await writeFile(
      resolve(store.paths.checkpointsDir, "run-1.json"),
      JSON.stringify(
        {
          runId: "run-1",
          updatedAt: new Date().toISOString(),
          checkpoint: {
            stage: "tool_result",
            goal: "fault coverage",
            messages: [
              { role: "system", content: "system" },
            ],
            iterations: 0,
            toolCalls: [],
            taskCalls: [],
            maxOutputTokens: 8192,
            compaction: {
              autocompactFailures: 0,
              reactiveCompactRetries: 0,
              tokenEscalations: 0,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const raw = await readFile(resolve(store.paths.checkpointsDir, "run-1.json"), "utf8");
    expect(raw).toContain("tool_result");

    await writeFile(
      resolve(store.paths.checkpointsDir, "run-1.json"),
      JSON.stringify(
        {
          runId: "run-1",
          updatedAt: new Date().toISOString(),
          checkpoint: {
            stage: "tool_result",
            goal: "",
            messages: [],
            iterations: 0,
            toolCalls: [],
            taskCalls: [],
            maxOutputTokens: 8192,
            compaction: {
              autocompactFailures: 0,
              reactiveCompactRetries: 0,
              tokenEscalations: 0,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(store.getCheckpoint("run-1")).rejects.toThrow("goal must be a non-empty string");
  });

  it("throws when session memory and summary payloads on disk do not validate", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await writeFile(
      resolve(store.paths.sessionMemoryDir, "run-1.json"),
      JSON.stringify(
        {
          runId: "run-1",
          goal: "fault coverage",
          status: "running",
          updatedAt: new Date().toISOString(),
          sourceRunUpdatedAt: new Date().toISOString(),
          headline: "runtime remains predictable",
          currentPhase: "reasoning",
          recentSteps: ["step-one"],
          blockers: [],
          openQuestions: [],
          artifactRefs: [],
          compactedMessages: 0,
          tokenEstimate: 12,
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      resolve(store.paths.summariesDir, "run-1.json"),
      JSON.stringify(buildSummaryRecord("run-1"), null, 2),
      "utf8",
    );

    await expect(store.getSessionMemory("run-1")).resolves.toMatchObject({
      runId: "run-1",
    });
    await expect(store.getLatestSummary("run-1")).resolves.toMatchObject({
      runId: "run-1",
    });

    await writeFile(
      resolve(store.paths.sessionMemoryDir, "run-1.json"),
      JSON.stringify(
        {
          runId: "run-1",
          goal: "fault coverage",
          status: "running",
          updatedAt: new Date().toISOString(),
          sourceRunUpdatedAt: new Date().toISOString(),
          headline: "",
          currentPhase: "reasoning",
          recentSteps: ["step-one"],
          blockers: [],
          openQuestions: [],
          artifactRefs: [],
          compactedMessages: 0,
          tokenEstimate: 12,
        },
        null,
        2,
      ),
      "utf8",
    );

    await writeFile(
      resolve(store.paths.summariesDir, "run-1.json"),
      JSON.stringify(
        {
          ...buildSummaryRecord("run-1"),
          messageCount: "bad",
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(store.getSessionMemory("run-1")).rejects.toThrow("headline must be a non-empty string");
    await expect(store.getLatestSummary("run-1")).rejects.toThrow("messageCount must be a non-negative integer");
  });

  it("throws when the memory index is corrupted on disk", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const record = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "memory should be validated on read",
    });

    const scopeDir = resolve(store.paths.memoryDir, "project__capstan");
    await writeFile(
      resolve(scopeDir, `${record.id}.json`),
      JSON.stringify(
        {
          ...record,
          content: "",
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      store.recallMemory({
        query: "memory validated",
        scopes: [{ type: "project", id: "capstan" }],
        limit: 5,
      }),
    ).rejects.toThrow("content must be a non-empty string");
  });

  it("throws when event streams contain malformed JSON", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await store.persistRun({
      id: "run-1",
      goal: "fault coverage",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      iterations: 0,
      toolCalls: 0,
      maxIterations: 10,
      toolNames: [],
      artifactIds: [],
      sandbox: {
        driver: "local",
        mode: "test",
        browser: false,
        fs: false,
        artifactDir: "/tmp/artifacts",
      },
      lastEventSequence: 0,
    });

    await writeFile(
      resolve(store.paths.eventsDir, "run-1.ndjson"),
      '{"id":"evt_1","runId":"run-1","sequence":1,"type":"run_started","timestamp":1,"data":{}}\nnot-json\n',
      "utf8",
    );

    await expect(store.getEvents("run-1")).rejects.toThrow();
  });

  it("returns undefined previews when preview reads fail for otherwise text artifacts", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir, {
      async mkdir(path, options) {
        await mkdir(path, options);
      },
      async readFile(path, encoding) {
        if (path.endsWith(".txt")) {
          throw Object.assign(new Error("preview read failed"), { code: "EACCES" });
        }
        return (await readFile(path, encoding as BufferEncoding)) as string;
      },
      readdir,
      rename,
      unlink,
      async writeFile(path, data, options) {
        await writeFile(path, data as string | Uint8Array, options as any);
      },
    });
    await store.initialize();

    await store.persistRun({
      id: "run-1",
      goal: "fault coverage",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      iterations: 0,
      toolCalls: 0,
      maxIterations: 10,
      toolNames: [],
      artifactIds: [],
      sandbox: {
        driver: "local",
        mode: "test",
        browser: false,
        fs: false,
        artifactDir: "/tmp/artifacts",
      },
      lastEventSequence: 0,
    });

    const artifact = await store.writeArtifact("run-1", {
      kind: "note",
      content: "preview should fall back to undefined",
      extension: ".txt",
      mimeType: "text/plain",
    });

    await expect(store.readArtifactPreview(artifact, 40)).resolves.toBeUndefined();
  });

  it("surfaces atomic write failures for session memory and summaries without committing records", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir, {
      async mkdir(path, options) {
        await mkdir(path, options);
      },
      async readFile(path, encoding) {
        return (await readFile(path, encoding as BufferEncoding)) as string;
      },
      readdir,
      async rename() {
        throw new Error("rename failed");
      },
      unlink,
      async writeFile(path, data, options) {
        await writeFile(path, data as string | Uint8Array, options as any);
      },
    });
    await store.initialize();

    await expect(
      store.persistSessionMemory(buildSessionMemoryRecord("run-1")),
    ).rejects.toThrow("rename failed");
    await expect(
      store.persistSummary(buildSummaryRecord("run-1")),
    ).rejects.toThrow("rename failed");

    await expect(store.getSessionMemory("run-1")).resolves.toBeUndefined();
    await expect(store.getLatestSummary("run-1")).resolves.toBeUndefined();
  });
});
