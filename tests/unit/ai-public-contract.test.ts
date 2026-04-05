import { describe, expect, it } from "bun:test";

import * as ai from "@zauso-ai/capstan-ai";
import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "@zauso-ai/capstan-ai";

function mockLLM(responses: Array<string | (() => Promise<string> | string)>): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[index++];
      return {
        content: typeof next === "function" ? await next() : next,
        model: "mock-1",
      };
    },
  };
}

describe("@zauso-ai/capstan-ai public contract after legacy memory cleanup", () => {
  it("does not export the removed standalone memory symbols from the package entrypoint", () => {
    expect("BuiltinMemoryBackend" in ai).toBe(false);
    expect("createMemoryAccessor" in ai).toBe(false);
    expect("MemoryBackend" in ai).toBe(false);
    expect("MemoryAccessor" in ai).toBe(false);
  });

  it("still exports the durable task runtime surface that replaces the old in-memory default", () => {
    expect(typeof ai.DurableAgentTaskRuntime).toBe("function");
    expect(typeof ai.InMemoryAgentTaskRuntime).toBe("function");
    expect(typeof ai.createInProcessAgentTaskWorker).toBe("function");
  });

  it("returns a minimal createAI surface with only think/generate/stream/agent capabilities", () => {
    const instance = ai.createAI({
      llm: mockLLM(["hello"]),
    });

    expect(Object.keys(instance).sort()).toEqual([
      "agent",
      "generate",
      "generateStream",
      "think",
      "thinkStream",
    ]);
    expect(Object.keys(instance.agent).sort()).toEqual(["run"]);
    expect("memory" in instance).toBe(false);
    expect("remember" in instance).toBe(false);
    expect("recall" in instance).toBe(false);
  });

  it("ignores legacy memory-shaped config input without reviving the removed memory surface", async () => {
    const instance = ai.createAI({
      llm: mockLLM(["answer"]),
      memory: {
        enabled: true,
        about: "legacy contract should be ignored",
      },
    } as never);

    expect(await instance.think("hello")).toBe("answer");
    expect("memory" in instance).toBe(false);
    expect("remember" in instance).toBe(false);
    expect("recall" in instance).toBe(false);
  });

  it("keeps agent.run usable even when callers pass old memory-shaped options through any-casts", async () => {
    const instance = ai.createAI({
      llm: mockLLM([
        '{"tool":"deploy","arguments":{"version":"v1"}}',
        "done",
      ]),
    } as never);

    const result = await instance.agent.run({
      goal: "deploy",
      tools: [
        {
          name: "deploy",
          description: "deploys",
          async execute(args) {
            return { deployed: args.version };
          },
        },
      ],
      memory: true,
      about: "legacy options should not affect execution",
    } as never);

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        tool: "deploy",
        result: { deployed: "v1" },
      }),
    ]);
  });

  it("does not leak memory fields through the standalone AI instance even after successful tool execution", async () => {
    const instance = ai.createAI({
      llm: mockLLM([
        '{"tool":"calc","arguments":{"a":20,"b":22}}',
        "42",
      ]),
    });

    const result = await instance.agent.run({
      goal: "compute 20 + 22",
      tools: [
        {
          name: "calc",
          description: "adds numbers",
          async execute(args) {
            return Number(args.a) + Number(args.b);
          },
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect("memory" in instance).toBe(false);
    expect("remember" in instance).toBe(false);
    expect("recall" in instance).toBe(false);
  });
});
