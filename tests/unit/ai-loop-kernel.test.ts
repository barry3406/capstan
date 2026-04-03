import { describe, expect, it } from "bun:test";

import type {
  AgentLoopCheckpoint,
  AgentTool,
} from "../../packages/ai/src/types.ts";
import { buildInitialLoopMessages } from "../../packages/ai/src/loop/messages.ts";
import { parseToolRequests } from "../../packages/ai/src/loop/sampler.ts";
import {
  applyCheckpoint,
  buildCheckpoint,
  createTurnEngineState,
} from "../../packages/ai/src/loop/state.ts";

describe("loop kernel internals", () => {
  it("builds the default message scaffold with explicit multi-tool instructions", () => {
    const tools: AgentTool[] = [
      {
        name: "lookup",
        description: "Looks up data",
        async execute() {
          return "ok";
        },
      },
    ];

    const messages = buildInitialLoopMessages(
      { goal: "inspect the record" },
      tools,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("lookup");
    expect(messages[0]?.content).toContain('{"tools": [{"tool": "<name>", "arguments": { ... }}]}');
    expect(messages[1]).toEqual({
      role: "user",
      content: "inspect the record",
    });
  });

  it("parses single, batched, and fenced tool requests", () => {
    expect(
      parseToolRequests(JSON.stringify({ tool: "lookup", arguments: { id: 1 } })),
    ).toHaveLength(1);

    expect(
      parseToolRequests(
        JSON.stringify({
          tools: [
            { tool: "lookup", arguments: { id: 1 } },
            { tool: "write", arguments: { id: 2 } },
          ],
        }),
      ).map((request) => request.name),
    ).toEqual(["lookup", "write"]);

    expect(
      parseToolRequests(
        '```json\n[{"tool":"lookup","arguments":{"id":1}},{"tool":"write","arguments":{"id":2}}]\n```',
      ).map((request) => request.name),
    ).toEqual(["lookup", "write"]);

    expect(parseToolRequests("plain text")).toEqual([]);
  });

  it("round-trips pending tool orchestration through checkpoints", () => {
    const checkpoint: AgentLoopCheckpoint = {
      stage: "assistant_response",
      config: { goal: "resume work", maxIterations: 5 },
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "resume work" },
      ],
      iterations: 2,
      toolCalls: [{ tool: "lookup", args: { id: 1 }, result: { ok: true } }],
      pendingToolCall: {
        assistantMessage:
          '{"tools":[{"tool":"write","arguments":{"value":"x"}},{"tool":"notify","arguments":{"channel":"ops"}}]}',
        tool: "write",
        args: { value: "x" },
      },
      lastAssistantResponse:
        '{"tools":[{"tool":"write","arguments":{"value":"x"}},{"tool":"notify","arguments":{"channel":"ops"}}]}',
      orchestration: {
        phase: "executing_tools",
        transitionReason: "next_turn",
        turnCount: 2,
        recovery: {
          reactiveCompactRetries: 0,
          tokenContinuations: 0,
          toolRecoveryCount: 0,
        },
        pendingToolRequests: [
          {
            id: "req-1",
            name: "write",
            args: { value: "x" },
            order: 0,
          },
          {
            id: "req-2",
            name: "notify",
            args: { channel: "ops" },
            order: 1,
          },
        ],
        lastModelFinishReason: "tool_use",
        assistantMessagePersisted: false,
      },
    };

    const state = createTurnEngineState(
      { goal: "resume work", maxIterations: 5 },
      [],
      {
        checkpoint,
        resumePendingTool: true,
      },
    );

    expect(state.pendingToolRequests.map((request) => request.name)).toEqual([
      "write",
      "notify",
    ]);
    expect(state.orchestration.transitionReason).toBe("manual_resume");
    expect(state.orchestration.assistantMessagePersisted).toBe(false);

    const roundTrip = buildCheckpoint(state, "assistant_response");
    expect(roundTrip.orchestration?.pendingToolRequests?.map((request) => request.name)).toEqual([
      "write",
      "notify",
    ]);

    const restored = createTurnEngineState({ goal: "other" }, [], undefined);
    applyCheckpoint(restored, roundTrip);
    expect(restored.pendingToolRequests.map((request) => request.name)).toEqual([
      "write",
      "notify",
    ]);
    expect(restored.orchestration.phase).toBe("executing_tools");
    expect(restored.orchestration.assistantMessagePersisted).toBe(false);
  });
});
