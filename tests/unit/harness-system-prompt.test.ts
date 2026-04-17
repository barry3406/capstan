import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createHarness } from "@zauso-ai/capstan-ai";
import type {
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
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-sysprompt-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Mock LLM that captures every messages array it receives so tests can
 * assert on the final system prompt actually handed to the model.
 */
function capturingLLM(responses: string[]): {
  llm: LLMProvider;
  calls: LLMMessage[][];
} {
  const calls: LLMMessage[][] = [];
  let idx = 0;
  const llm: LLMProvider = {
    name: "capturing-mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      // Clone to avoid mutation by later loop steps
      calls.push(messages.map((m) => ({ ...m })));
      const content = responses[idx++] ?? "done";
      return { content, model: "capturing-mock-1" };
    },
  };
  return { llm, calls };
}

describe("Harness.run() forwards AgentRunConfig.systemPrompt to the LLM", () => {
  it("places the configured systemPrompt as messages[0] (role=system) on the first LLM call", async () => {
    const rootDir = await createTempDir();
    const { llm, calls } = capturingLLM(["task complete"]);
    const harness = await createHarness({
      llm,
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const marker = "CAPSTAN_SYSTEM_PROMPT_FORWARDING_MARKER_v1";
    const customSystemPrompt = `You are a specialized test agent. ${marker}`;

    const result = await harness.run({
      goal: "hello world",
      systemPrompt: customSystemPrompt,
      tools: [],
    });

    expect(result.status).toBe("completed");
    expect(calls.length).toBeGreaterThanOrEqual(1);

    const firstCall = calls[0]!;
    expect(firstCall[0]!.role).toBe("system");

    // The system message MUST contain the caller-supplied systemPrompt text.
    // Note: the engine may append tool/memory/skill sections after the base,
    // so we use includes() rather than equality.
    expect(firstCall[0]!.content).toContain(marker);
    expect(firstCall[0]!.content).toContain("specialized test agent");

    // Sanity: user goal is in messages[1] (not prepended/duplicated into system)
    expect(firstCall[1]!.role).toBe("user");
    expect(firstCall[1]!.content).toBe("hello world");
  });

  it("falls back to the default system prompt when systemPrompt is not provided", async () => {
    const rootDir = await createTempDir();
    const { llm, calls } = capturingLLM(["done"]);
    const harness = await createHarness({
      llm,
      runtime: { rootDir },
      verify: { enabled: false },
    });

    await harness.run({
      goal: "no custom prompt",
      tools: [],
    });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const systemMsg = calls[0]![0]!;
    expect(systemMsg.role).toBe("system");
    // Default base prompt mentions "autonomous agent"
    expect(systemMsg.content).toContain("autonomous agent");
  });
});
