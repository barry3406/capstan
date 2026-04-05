import { describe, expect, it } from "bun:test";

import {
  InMemoryAgentLoopMailbox,
} from "../../packages/ai/src/index.ts";
import type {
  AgentTool,
  AgentToolProgressUpdate,
} from "../../packages/ai/src/index.ts";
import { createTurnEngineState } from "../../packages/ai/src/loop/state.ts";
import { executeToolRequests } from "../../packages/ai/src/loop/tool-orchestrator.ts";

describe("streaming tool execution pipeline", () => {
  it("emits progress updates and persists tool_progress mailbox events in order", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const progress: AgentToolProgressUpdate[] = [];
    const tool: AgentTool = {
      name: "stream-fetch",
      description: "streaming fetch tool",
      async execute() {
        throw new Error("execute should not be called when executeStreaming is present");
      },
      async *executeStreaming() {
        yield { type: "progress", message: "connecting" };
        yield {
          type: "progress",
          message: "downloading",
          detail: { bytes: 128 },
        };
        yield {
          type: "result",
          result: {
            ok: true,
            body: "payload",
          },
        };
      },
    };

    const state = createTurnEngineState(
      { goal: "stream a tool result" },
      [tool],
    );
    state.pendingToolRequests = [
      {
        id: "req_stream",
        name: "stream-fetch",
        args: { id: "asset_1" },
        order: 0,
        assistantMessage: '{"tool":"stream-fetch","arguments":{"id":"asset_1"}}',
      },
    ];

    const outcome = await executeToolRequests(
      state,
      {
        runId: "stream-run",
        mailbox,
        onToolProgress: async (_tool, _args, update) => {
          progress.push(update);
        },
      },
      false,
    );

    expect(progress).toEqual([
      { type: "progress", message: "connecting" },
      { type: "progress", message: "downloading", detail: { bytes: 128 } },
    ]);
    expect(outcome.records).toEqual([
      expect.objectContaining({
        tool: "stream-fetch",
        status: "success",
        result: { ok: true, body: "payload" },
      }),
    ]);

    const mailboxMessages = await mailbox.list("stream-run");
    expect(
      mailboxMessages
        .filter((message) => message.kind === "tool_progress")
        .map((message) => ({
          tool: message.kind === "tool_progress" ? message.tool : undefined,
          message: message.kind === "tool_progress" ? message.message : undefined,
          detail: message.kind === "tool_progress" ? message.detail : undefined,
        })),
    ).toEqual([
      { tool: "stream-fetch", message: "connecting", detail: undefined },
      { tool: "stream-fetch", message: "downloading", detail: { bytes: 128 } },
    ]);
  });

  it("aborts concurrency-safe sibling tools after a hard streaming failure", async () => {
    let siblingSawAbort = false;
    const tools: AgentTool[] = [
      {
        name: "hard-stream-fail",
        description: "fails hard while streaming",
        isConcurrencySafe: true,
        failureMode: "hard",
        async *executeStreaming() {
          yield { type: "progress", message: "starting" };
          throw new Error("stream exploded");
        },
        async execute() {
          throw new Error("execute fallback should not run");
        },
      },
      {
        name: "slow-stream",
        description: "checks for sibling abort",
        isConcurrencySafe: true,
        async *executeStreaming(_args, context) {
          while (!context.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          siblingSawAbort = true;
          throw new Error(String(context.signal.reason ?? "aborted"));
        },
        async execute() {
          throw new Error("execute fallback should not run");
        },
      },
    ];

    const state = createTurnEngineState(
      { goal: "abort siblings on hard failure" },
      tools,
    );
    state.pendingToolRequests = [
      {
        id: "req_hard",
        name: "hard-stream-fail",
        args: {},
        order: 0,
        assistantMessage: '{"tools":[{"tool":"hard-stream-fail","arguments":{}},{"tool":"slow-stream","arguments":{}}]}',
      },
      {
        id: "req_slow",
        name: "slow-stream",
        args: {},
        order: 1,
        assistantMessage: '{"tools":[{"tool":"hard-stream-fail","arguments":{}},{"tool":"slow-stream","arguments":{}}]}',
      },
    ];

    const outcome = await executeToolRequests(state, undefined, false);

    expect(outcome.haltedByHardFailure).toBe(true);
    expect(siblingSawAbort).toBe(true);
    expect(outcome.records).toEqual([
      expect.objectContaining({
        tool: "hard-stream-fail",
        status: "error",
        result: { error: "stream exploded" },
      }),
      expect.objectContaining({
        tool: "slow-stream",
        status: "error",
      }),
    ]);
    expect(outcome.remaining).toEqual([]);
  });

  it("returns an error record when a streaming tool finishes without a result update", async () => {
    const tool: AgentTool = {
      name: "stream-without-result",
      description: "emits progress but no final result",
      async execute() {
        throw new Error("execute fallback should not run");
      },
      async *executeStreaming() {
        yield { type: "progress", message: "starting" };
      },
    };

    const state = createTurnEngineState({ goal: "surface missing result" }, [tool]);
    state.pendingToolRequests = [
      {
        id: "req_missing_result",
        name: "stream-without-result",
        args: {},
        order: 0,
        assistantMessage: '{"tool":"stream-without-result","arguments":{}}',
      },
    ];

    const outcome = await executeToolRequests(state, undefined, false);
    expect(outcome.records).toEqual([
      expect.objectContaining({
        tool: "stream-without-result",
        status: "error",
        result: { error: 'Streaming tool "stream-without-result" completed without a result update' },
      }),
    ]);
  });

  it("does not convert a successful streaming tool into a failure when progress observers throw", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const tool: AgentTool = {
      name: "observer-resistant",
      description: "continues even if progress observers fail",
      async execute() {
        throw new Error("execute fallback should not run");
      },
      async *executeStreaming() {
        yield { type: "progress", message: "phase-1" };
        yield { type: "result", result: { ok: true } };
      },
    };

    const state = createTurnEngineState({ goal: "ignore progress observer failures" }, [tool]);
    state.pendingToolRequests = [
      {
        id: "req_progress_failure",
        name: "observer-resistant",
        args: { id: 1 },
        order: 0,
        assistantMessage: '{"tool":"observer-resistant","arguments":{"id":1}}',
      },
    ];

    const outcome = await executeToolRequests(
      state,
      {
        runId: "progress-failure-run",
        mailbox,
        onToolProgress: async () => {
          throw new Error("progress observer offline");
        },
      },
      false,
    );

    expect(outcome.records).toEqual([
      expect.objectContaining({
        tool: "observer-resistant",
        status: "success",
        result: { ok: true },
      }),
    ]);
    expect(await mailbox.list("progress-failure-run")).toEqual([
      expect.objectContaining({
        kind: "tool_progress",
        tool: "observer-resistant",
        message: "phase-1",
      }),
    ]);
  });

  it("returns ordered records even when concurrency-safe streaming tools settle out of order", async () => {
    const tools: AgentTool[] = [
      {
        name: "slow-first",
        description: "slow tool with lower order",
        isConcurrencySafe: true,
        async execute() {
          throw new Error("execute fallback should not run");
        },
        async *executeStreaming() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          yield { type: "result", result: "slow" };
        },
      },
      {
        name: "fast-second",
        description: "fast tool with higher order",
        isConcurrencySafe: true,
        async execute() {
          throw new Error("execute fallback should not run");
        },
        async *executeStreaming() {
          yield { type: "result", result: "fast" };
        },
      },
    ];

    const state = createTurnEngineState({ goal: "keep result order stable" }, tools);
    state.pendingToolRequests = [
      {
        id: "req_slow",
        name: "slow-first",
        args: {},
        order: 0,
        assistantMessage: '{"tools":[{"tool":"slow-first","arguments":{}},{"tool":"fast-second","arguments":{}}]}',
      },
      {
        id: "req_fast",
        name: "fast-second",
        args: {},
        order: 1,
        assistantMessage: '{"tools":[{"tool":"slow-first","arguments":{}},{"tool":"fast-second","arguments":{}}]}',
      },
    ];

    const outcome = await executeToolRequests(state, undefined, false);

    expect(outcome.records.map((record) => ({ tool: record.tool, result: record.result }))).toEqual([
      { tool: "slow-first", result: "slow" },
      { tool: "fast-second", result: "fast" },
    ]);
  });

  it("does not hang forever when an aborted parallel sibling ignores the abort signal", async () => {
    const startedAt = Date.now();
    const tools: AgentTool[] = [
      {
        name: "hard-fail-fast",
        description: "triggers sibling aborts",
        isConcurrencySafe: true,
        failureMode: "hard",
        async execute() {
          throw new Error("execute fallback should not run");
        },
        async *executeStreaming() {
          throw new Error("boom");
        },
      },
      {
        name: "non-cooperative",
        description: "ignores abort and never resolves within the grace window",
        isConcurrencySafe: true,
        async execute() {
          throw new Error("execute fallback should not run");
        },
        async *executeStreaming() {
          await new Promise((resolve) => setTimeout(resolve, 250));
          yield { type: "result", result: "too-late" };
        },
      },
    ];

    const state = createTurnEngineState({ goal: "guard parallel aborts" }, tools);
    state.pendingToolRequests = [
      {
        id: "req_hard",
        name: "hard-fail-fast",
        args: {},
        order: 0,
        assistantMessage: '{"tools":[{"tool":"hard-fail-fast","arguments":{}},{"tool":"non-cooperative","arguments":{}}]}',
      },
      {
        id: "req_ignore",
        name: "non-cooperative",
        args: {},
        order: 1,
        assistantMessage: '{"tools":[{"tool":"hard-fail-fast","arguments":{}},{"tool":"non-cooperative","arguments":{}}]}',
      },
    ];

    const outcome = await executeToolRequests(state, undefined, false);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(200);
    expect(outcome.haltedByHardFailure).toBe(true);
    expect(outcome.records).toEqual([
      expect.objectContaining({
        tool: "hard-fail-fast",
        status: "error",
        result: { error: "boom" },
      }),
      expect.objectContaining({
        tool: "non-cooperative",
        status: "error",
        result: expect.objectContaining({
          error: expect.stringContaining('aborted after sibling hard failure'),
        }),
      }),
    ]);
  });
});
