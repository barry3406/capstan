import { describe, expect, it } from "bun:test";

import { runAgentLoop } from "@zauso-ai/capstan-ai";
import type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
} from "@zauso-ai/capstan-ai";

describe("turn engine continuation and recovery", () => {
  it("continues after max_output_tokens with a transient continuation prompt", async () => {
    const capturedMessages: LLMMessage[][] = [];
    let calls = 0;

    const llm: LLMProvider = {
      name: "continuation-provider",
      async chat(messages): Promise<LLMResponse> {
        capturedMessages.push(messages.map((message) => ({ ...message })));
        calls++;
        if (calls === 1) {
          return {
            content: "Partial answer.",
            model: "mock-1",
            finishReason: "max_output_tokens",
          };
        }
        return {
          content: "Final answer.",
          model: "mock-1",
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(llm, { goal: "Answer carefully" }, []);

    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(2);
    expect(result.result).toBe("Final answer.");
    expect(
      capturedMessages[1]?.some((message) =>
        message.content.includes("Continue from exactly where you left off"),
      ),
    ).toBe(true);
    expect(
      result.checkpoint?.messages.some((message) =>
        message.content.includes("Continue from exactly where you left off"),
      ),
    ).toBe(false);
    expect(
      result.checkpoint?.messages.some((message) =>
        message.role === "assistant" && message.content === "Partial answer.",
      ),
    ).toBe(true);
    expect(result.checkpoint?.orchestration?.recovery.tokenContinuations).toBe(1);
  });

  it("recovers from prompt-too-long errors by compacting and retrying", async () => {
    const capturedMessages: LLMMessage[][] = [];
    let calls = 0;

    const llm: LLMProvider = {
      name: "retry-provider",
      async chat(messages): Promise<LLMResponse> {
        capturedMessages.push(messages.map((message) => ({ ...message })));
        calls++;
        if (calls === 1) {
          throw new Error("prompt too long for current model");
        }
        return {
          content: "Recovered after compaction.",
          model: "mock-1",
          finishReason: "stop",
        };
      },
    };

    const checkpointMessages: LLMMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "goal" },
      { role: "assistant", content: "step 1" },
      { role: "user", content: "Tool \"lookup\" returned:\n{\"body\":\"x\"}" },
      { role: "assistant", content: "step 2" },
      { role: "user", content: "Tool \"fetch\" returned:\n{\"body\":\"y\"}" },
      { role: "assistant", content: "step 3" },
      { role: "user", content: "Need one more answer" },
    ];

    const result = await runAgentLoop(
      llm,
      { goal: "Recover from context pressure", maxIterations: 4 },
      [],
      {
        checkpoint: {
          stage: "initialized",
          config: {
            goal: "Recover from context pressure",
            maxIterations: 4,
          },
          messages: checkpointMessages,
          iterations: 0,
          toolCalls: [],
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(2);
    expect(
      capturedMessages[1]?.some((message) =>
        message.content.includes("[HOST_COMPACT_RETRY]"),
      ),
    ).toBe(true);
    expect(
      capturedMessages[1]?.some((message) =>
        message.content.includes("previous attempt exceeded the prompt budget"),
      ),
    ).toBe(true);
    expect(result.checkpoint?.orchestration?.recovery.reactiveCompactRetries).toBe(1);
  });

  it("uses stream sampling inside runAgentLoop when the provider supports it", async () => {
    const streamedMessages: LLMMessage[][] = [];
    let streamCalls = 0;
    let chatCalls = 0;

    const llm: LLMProvider = {
      name: "streaming-agent-provider",
      async chat(): Promise<LLMResponse> {
        chatCalls++;
        return { content: "chat fallback", model: "mock-1" };
      },
      async *stream(messages): AsyncIterable<LLMStreamChunk> {
        streamedMessages.push(messages.map((message) => ({ ...message })));
        streamCalls++;
        if (streamCalls === 1) {
          yield {
            content: '{"tool":"lookup","arguments":{"sku":"abc"}}',
            done: false,
          };
        } else {
          yield { content: "streamed final answer", done: false };
        }
        yield { content: "", done: true };
      },
    };

    const result = await runAgentLoop(
      llm,
      { goal: "Use stream path" },
      [
        {
          name: "lookup",
          description: "lookup",
          async execute(args) {
            return { sku: args.sku, ok: true };
          },
        },
      ],
    );

    expect(chatCalls).toBe(0);
    expect(streamCalls).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.result).toBe("streamed final answer");
  });
});
