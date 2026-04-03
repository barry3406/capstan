import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
  AgentLoopCheckpoint,
  HarnessRunRecord,
} from "../../packages/ai/src/index.ts";
import { HarnessContextKernel } from "../../packages/ai/src/harness/context/kernel.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-faults-"));
  tempDirs.push(dir);
  return dir;
}

function createRun(
  id: string,
  patch: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  return {
    id,
    goal: `goal:${id}`,
    status: "running",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    iterations: 0,
    toolCalls: 0,
    maxIterations: 5,
    toolNames: [],
    artifactIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: `/artifacts/${id}`,
    },
    lastEventSequence: 0,
    ...patch,
  };
}

function createCheckpoint(
  patch: Partial<AgentLoopCheckpoint> = {},
): AgentLoopCheckpoint {
  return {
    stage: "tool_result",
    config: {
      goal: "goal:run-a",
      maxIterations: 5,
      systemPrompt: "You are a coding agent.",
    },
    messages: [
      { role: "system", content: "You are a coding agent." },
      { role: "user", content: "goal:run-a" },
      { role: "assistant", content: "done" },
    ],
    iterations: 1,
    toolCalls: [],
    lastAssistantResponse: "done",
    ...patch,
  };
}

describe("Harness context kernel fault handling", () => {
  it("rejects corrupted session memory files through the kernel API", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await writeFile(
      join(store.paths.sessionMemoryDir, "run-a.json"),
      "{broken json\n",
      "utf8",
    );

    const kernel = new HarnessContextKernel(store);
    await expect(kernel.getSessionMemory("run-a")).rejects.toThrow();
  });

  it("rejects corrupted summary files through both getLatestSummary and listSummaries", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await writeFile(
      join(store.paths.summariesDir, "run-a.json"),
      "{broken json\n",
      "utf8",
    );

    const kernel = new HarnessContextKernel(store);
    await expect(kernel.getLatestSummary("run-a")).rejects.toThrow();
    await expect(kernel.listSummaries()).rejects.toThrow();
  });

  it("rejects invalid memory entries instead of silently hiding them", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    const scopeDir = join(store.paths.memoryDir, "run__run-a");
    await mkdir(scopeDir, { recursive: true });
    await writeFile(
      join(scopeDir, "mem-a.json"),
      JSON.stringify({
        id: "mem-a",
        scope: { type: "run", id: "run-a" },
        kind: "observation",
        content: "ok",
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        accessCount: -1,
        lastAccessedAt: "2026-04-03T00:00:00.000Z",
      }),
      "utf8",
    );

    const kernel = new HarnessContextKernel(store);
    await expect(
      kernel.recallMemory({
        query: "ok",
        scopes: [{ type: "run", id: "run-a" }],
        limit: 10,
        minScore: 0,
      }),
    ).rejects.toThrow("Harness memory record mem-a is invalid: accessCount");
  });

  it("assembleContext tolerates missing artifact payloads by dropping previews", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(
      createRun("run-a", {
        status: "completed",
        updatedAt: "2026-04-03T00:00:05.000Z",
      }),
    );
    await store.persistCheckpoint(
      "run-a",
      createCheckpoint({
        stage: "completed",
      }),
    );

    const artifact = await store.writeArtifact("run-a", {
      kind: "report",
      content: "preview me",
      extension: ".md",
      mimeType: "text/markdown",
    });
    await store.patchRun("run-a", {
      artifactIds: [artifact.id],
    });
    await unlink(artifact.path);

    const kernel = new HarnessContextKernel(store, {
      enabled: true,
      maxArtifacts: 4,
    });
    await kernel.captureRunState("run-a");

    const context = await kernel.assembleContext("run-a", {
      query: "report",
      maxTokens: 1_500,
    });

    expect(context.artifactRefs).toHaveLength(1);
    expect(context.artifactRefs[0]?.artifactId).toBe(artifact.id);
    expect(context.artifactRefs[0]?.preview).toBeUndefined();
    expect(context.blocks.some((block) => block.kind === "artifact")).toBe(true);
  });

  it("captureRunState returns session memory even when no checkpoint exists", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("run-a"));

    const kernel = new HarnessContextKernel(store, {
      enabled: true,
    });
    const captured = await kernel.captureRunState("run-a");

    expect(captured.sessionMemory.runId).toBe("run-a");
    expect(captured.summary).toBeUndefined();
    expect(captured.promotedMemories).toEqual([]);
  });

  it("handleCheckpoint in disabled mode leaves the checkpoint untouched and writes no summary", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("run-a"));

    const kernel = new HarnessContextKernel(store, {
      enabled: false,
      autoPromoteSummaries: true,
      autoPromoteObservations: true,
    });

    const checkpoint = createCheckpoint({
      messages: [
        { role: "system", content: "You are a coding agent." },
        { role: "user", content: "goal:run-a" },
        { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"key\":\"a\"}}" },
        {
          role: "user",
          content: `Tool "lookup" returned:\n${"a".repeat(500)}`,
        },
      ],
    });

    const update = await kernel.handleCheckpoint({ runId: "run-a", checkpoint });

    expect(update.checkpoint).toEqual(checkpoint);
    expect(update.summary).toBeUndefined();
    expect(update.promotedMemories).toEqual([]);
    expect(await kernel.getLatestSummary("run-a")).toBeUndefined();
    expect(await kernel.getSessionMemory("run-a")).toBeUndefined();
  });
});
