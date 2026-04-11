import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createHarness,
  openHarnessRuntime,
  createSmartAgent,
} from "@zauso-ai/capstan-ai";
import type {
  AgentTool,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-stage2-edge-"));
  tempDirs.push(dir);
  return dir;
}

function createMockLLM(
  responses: Array<string | Error | (() => Promise<string> | string)>,
  sink?: LLMMessage[][],
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(messages.map((message) => ({ ...message })));
      const next = responses[callIndex++];
      if (next instanceof Error) {
        throw next;
      }
      const content = typeof next === "function" ? await next() : (next ?? "done");
      return { content, model: "mock-1" };
    },
  };
}

describe("Stage 2 harness edge cases", () => {
  it("applies checkpoint rewrites before the next model call and keeps the compacted transcript", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = createMockLLM(
      [
        JSON.stringify({ tool: "lookup", arguments: { sku: "abc" } }),
        "Final answer",
      ],
      capturedMessages,
    );

    const tool: AgentTool = {
      name: "lookup",
      description: "returns a large payload",
      async execute() {
        return { payload: "secret ".repeat(40) };
      },
    };

    const checkpointStages: string[] = [];
    const agent = createSmartAgent({
      llm,
      tools: [tool],
      hooks: {
        onCheckpoint: async (checkpoint) => {
          checkpointStages.push(checkpoint.stage);
          return undefined;
        },
      },
    });
    const result = await agent.run("Investigate pricing regression");

    expect(result.status).toBe("completed");
    expect(checkpointStages).toContain("tool_result");
    expect(capturedMessages).toHaveLength(2);
  });

  it("injects transient context without mutating the persisted transcript when no system prompt exists", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = createMockLLM(["done"], capturedMessages);

    const agent = createSmartAgent({
      llm,
      tools: [],
      prompt: {
        layers: [
          {
            id: "runtime-context",
            content: "Runtime context below is authoritative.",
            position: "prepend",
            priority: 100,
          },
        ],
      },
    });
    const result = await agent.run("Inspect a record");

    expect(result.status).toBe("completed");
    expect(capturedMessages[0]![0]!.content).toContain(
      "Runtime context below is authoritative.",
    );
    expect(result.checkpoint?.messages[0]?.role).toBe("system");
  });

  it("refreshes a canceled approval-blocked run so context assembly and replay reflect the terminal state", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: createMockLLM([
        JSON.stringify({ tool: "delete", arguments: { id: "123" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "manual approval required",
        }),
      },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 400,
        reserveOutputTokens: 0,
        autoPromoteObservations: true,
        autoPromoteSummaries: true,
      },
    });

    const blocked = await harness.run({
      goal: "Delete the record",
      tools: [
        {
          name: "delete",
          description: "deletes a record",
          async execute() {
            return { deleted: true };
          },
        },
      ],
    });

    expect(blocked.status).toBe("approval_required");

    const canceled = await harness.cancelRun(blocked.runId);
    expect(canceled.status).toBe("canceled");

    const replay = await harness.replayRun(blocked.runId);
    expect(replay.storedStatus).toBe("canceled");
    expect(replay.derivedStatus).toBe("canceled");

    const events = await harness.getEvents(blocked.runId);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("run_started");
    expect(eventTypes).toContain("approval_required");
    expect(eventTypes).toContain("approval_canceled");
    expect(eventTypes).toContain("run_canceled");

    await harness.destroy();
  });

  it("flags replay inconsistency when the stored run record diverges from the event log", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: createMockLLM(["All done."]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "Inspect the final state" });
    const runPath = join(harness.getPaths().runsDir, `${result.runId}.json`);
    const storedRun = JSON.parse(await readFile(runPath, "utf8")) as {
      status: string;
    };
    storedRun.status = "running";
    await writeFile(runPath, `${JSON.stringify(storedRun, null, 2)}\n`, "utf8");

    const runtime = await openHarnessRuntime(rootDir);
    const replay = await runtime.replayRun(result.runId);

    expect(replay.consistent).toBe(false);
    expect(replay.storedStatus).toBe("running");
    expect(replay.derivedStatus).toBe("completed");

    await harness.destroy();
  });
});
