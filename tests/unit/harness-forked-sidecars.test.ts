import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createHarness,
} from "../../packages/ai/src/index.ts";
import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-forked-sidecars-"));
  tempDirs.push(dir);
  return dir;
}

function createForkedSidecarLLM(): LLMProvider {
  return {
    name: "forked-sidecar-mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const systemPrompt = messages.find((message) => message.role === "system")?.content ?? "";
      const hasStoreToolResult = messages.some(
        (message) =>
          message.content.includes("store_memory_candidate") &&
          message.content.includes("returned"),
      );
      if (systemPrompt.includes("background memory extraction agent")) {
        if (!hasStoreToolResult) {
          return {
            model: "mock-1",
            content: JSON.stringify({
              tool: "store_memory_candidate",
              arguments: {
                kind: "fact",
                importance: "high",
                content: "Durable memory from sidecar extraction",
              },
            }),
          };
        }
        return {
          model: "mock-1",
          content: "No more durable memories.",
        };
      }

      return {
        model: "mock-1",
        content: "main run done",
      };
    },
  };
}

describe("forked-agent sidecars", () => {
  it("runs long-term memory extraction as a background subagent task and persists the extracted memories", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: createForkedSidecarLLM(),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteObservations: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
      sidecars: {
        longTermMemory: {
          enabled: true,
          agentic: true,
        },
      },
    });

    const result = await harness.run({
      goal: "Inspect the latest operational issue and capture durable learnings",
    }, {
      graphScopes: [{ kind: "project", projectId: "capstan-sidecar-project" }],
    });

    const events = await harness.getEvents(result.runId);
    expect(
      events.some(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "long_term_memory_extract" &&
          event.data.mode === "background",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "long_term_memory_extract" &&
          event.data.mode === "background",
      ),
    ).toBe(true);

    const memories = await harness.recallMemory({
      query: "Durable memory from sidecar extraction",
      minScore: 0,
      limit: 10,
    });
    expect(memories).toContainEqual(
      expect.objectContaining({
        kind: "fact",
        content: "Durable memory from sidecar extraction",
        graphScopes: [{ kind: "project", projectId: "capstan-sidecar-project" }],
        metadata: expect.objectContaining({
          source: "sidecar.long_term_memory.subagent",
        }),
      }),
    );
  }, 20_000);

  it("can route agentic long-term extraction through a dedicated sidecar llm without consuming the main run provider", async () => {
    const rootDir = await createTempDir();
    let mainCalls = 0;
    let sidecarCalls = 0;
    const mainLLM: LLMProvider = {
      name: "main",
      async chat(): Promise<LLMResponse> {
        mainCalls += 1;
        return {
          model: "main-1",
          content: `main-response-${mainCalls}`,
        };
      },
    };
    const sidecarLLM: LLMProvider = {
      name: "sidecar",
      async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
        sidecarCalls += 1;
        const hasStored = messages.some((message) =>
          message.content.includes("store_memory_candidate") &&
          message.content.includes("returned"),
        );
        return {
          model: "sidecar-1",
          content: hasStored
            ? "no-op"
            : JSON.stringify({
                tool: "store_memory_candidate",
                arguments: {
                  kind: "fact",
                  content: "Dedicated sidecar memory",
                },
              }),
        };
      },
    };

    const harness = await createHarness({
      llm: mainLLM,
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
      sidecars: {
        longTermMemory: {
          enabled: true,
          agentic: true,
          llm: sidecarLLM,
        },
      },
    });

    const first = await harness.run({ goal: "first run" });
    const second = await harness.run({ goal: "second run" });

    expect(first.result).toBe("main-response-1");
    expect(second.result).toBe("main-response-2");
    expect(mainCalls).toBe(2);
    expect(sidecarCalls).toBeGreaterThan(0);

    const memories = await harness.recallMemory({
      query: "Dedicated sidecar memory",
      minScore: 0,
      limit: 10,
    });
    expect(memories).toContainEqual(
      expect.objectContaining({
        content: "Dedicated sidecar memory",
        metadata: expect.objectContaining({
          source: "sidecar.long_term_memory.subagent",
        }),
      }),
    );
  }, 20_000);
});
