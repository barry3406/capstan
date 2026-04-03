import { describe, expect, it } from "bun:test";

import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
} from "../../packages/ai/src/types.ts";
import {
  parseToolRequests,
  sampleModel,
} from "../../packages/ai/src/loop/sampler.ts";

describe("loop sampler", () => {
  it("parses single, batched, and fenced-json tool request payloads", () => {
    expect(
      parseToolRequests(
        JSON.stringify({ tool: "lookup", arguments: { id: "sku_1" } }),
      ),
    ).toEqual([
      expect.objectContaining({
        name: "lookup",
        args: { id: "sku_1" },
        order: 0,
      }),
    ]);

    expect(
      parseToolRequests(
        JSON.stringify({
          tools: [
            { tool: "lookup", arguments: { id: "a" } },
            { tool: "summarize", arguments: { id: "a" } },
          ],
        }),
      ).map((request) => ({
        name: request.name,
        args: request.args,
        order: request.order,
      })),
    ).toEqual([
      { name: "lookup", args: { id: "a" }, order: 0 },
      { name: "summarize", args: { id: "a" }, order: 1 },
    ]);

    expect(
      parseToolRequests(
        "```json\n" +
          JSON.stringify([
            { tool: "fetch", arguments: { id: 1 } },
            { tool: "index", arguments: { id: 1 } },
          ]) +
          "\n```",
      ).map((request) => request.name),
    ).toEqual(["fetch", "index"]);

    expect(parseToolRequests("plain text")).toEqual([]);
  });

  it("prefers stream() when available and reconstructs tool calls across chunks", async () => {
    const streamedMessages: LLMMessage[][] = [];
    let chatCalls = 0;

    const provider: LLMProvider = {
      name: "streaming-provider",
      async chat(): Promise<LLMResponse> {
        chatCalls++;
        return { content: "chat fallback", model: "mock-1" };
      },
      async *stream(
        messages: LLMMessage[],
        _opts?: LLMOptions,
      ): AsyncIterable<LLMStreamChunk> {
        streamedMessages.push(messages.map((message) => ({ ...message })));
        yield {
          content: '{"tools":[{"tool":"fetch","arguments":{"id":"sku_1"}},',
          done: false,
        };
        yield {
          content: '{"tool":"summarize","arguments":{"id":"sku_1"}}]}',
          done: false,
        };
        yield { content: "", done: true };
      },
    };

    const outcome = await sampleModel(provider, [
      { role: "system", content: "system" },
      { role: "user", content: "goal" },
    ]);

    expect(chatCalls).toBe(0);
    expect(streamedMessages).toHaveLength(1);
    expect(outcome.finishReason).toBe("tool_use");
    expect(outcome.toolRequests.map((request) => request.name)).toEqual([
      "fetch",
      "summarize",
    ]);
  });

  it("normalizes finish reasons from provider chat responses", async () => {
    const scenarios: Array<{
      finishReason: string;
      expected: string;
    }> = [
      { finishReason: "max_output_tokens", expected: "max_output_tokens" },
      { finishReason: "length", expected: "max_output_tokens" },
      { finishReason: "context_window_exceeded", expected: "context_limit" },
      { finishReason: "stop", expected: "stop" },
    ];

    for (const scenario of scenarios) {
      const provider: LLMProvider = {
        name: "chat-provider",
        async chat(): Promise<LLMResponse> {
          return {
            content: "plain text result",
            model: "mock-1",
            finishReason: scenario.finishReason,
          };
        },
      };

      const outcome = await sampleModel(provider, [
        { role: "system", content: "system" },
        { role: "user", content: "goal" },
      ]);

      expect(outcome.finishReason).toBe(scenario.expected);
      expect(outcome.toolRequests).toEqual([]);
    }
  });
});
