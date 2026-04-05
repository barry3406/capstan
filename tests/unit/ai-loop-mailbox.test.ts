import { describe, expect, it } from "bun:test";

import {
  InMemoryAgentLoopMailbox,
  runAgentLoop,
} from "../../packages/ai/src/index.ts";
import type {
  AgentTask,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/index.ts";
import { drainMailboxContextMessages } from "../../packages/ai/src/loop/mailbox.ts";

function createChatProvider(
  responder: (messages: LLMMessage[]) => string | Promise<string>,
): LLMProvider {
  return {
    name: "mailbox-mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      return {
        content: await responder(messages.map((message) => ({ ...message }))),
        model: "mock-1",
      };
    },
  };
}

describe("agent loop mailbox integration", () => {
  it("skips stale control signals while preserving preceding non-control mailbox context", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const runId = "run_mailbox_stale_control";
    const seenIds: string[] = [];

    await mailbox.publish({
      id: "control_pause_old",
      runId,
      createdAt: new Date().toISOString(),
      kind: "control_signal",
      action: "pause",
      requestedAt: "2026-04-05T00:00:00.000Z",
      reason: "stale pause",
    });
    await mailbox.publish({
      id: "system_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "operator.note",
      detail: { message: "keep context" },
    });
    await mailbox.publish({
      id: "control_cancel_new",
      runId,
      createdAt: new Date().toISOString(),
      kind: "control_signal",
      action: "cancel",
      requestedAt: "2026-04-05T00:00:01.000Z",
      reason: "fresh cancel",
    });

    const drained = await drainMailboxContextMessages(
      mailbox,
      runId,
      async (message) => {
        seenIds.push(message.id);
      },
      async (message) => message.id !== "control_pause_old",
    );

    expect(seenIds).toEqual(["control_pause_old", "system_1", "control_cancel_new"]);
    expect(drained.messages).toEqual([
      {
        role: "user",
        content: 'Runtime system event: operator.note\n{"message":"keep context"}',
      },
    ]);
    expect(drained.control).toEqual({
      action: "cancel",
      requestedAt: "2026-04-05T00:00:01.000Z",
      reason: "fresh cancel",
    });
  });

  it("removes timed out waiters instead of delivering future messages to dead listeners", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const runId = "run_mailbox_waiter_timeout";

    expect(await mailbox.next(runId, { timeoutMs: 10 })).toBeUndefined();

    await mailbox.publish({
      id: "context_after_timeout",
      runId,
      createdAt: new Date().toISOString(),
      kind: "context_message",
      source: "operator",
      message: {
        role: "user",
        content: "still queued",
      },
    });

    expect(await mailbox.list(runId)).toEqual([
      expect.objectContaining({
        id: "context_after_timeout",
        kind: "context_message",
      }),
    ]);
    expect(await mailbox.next(runId, { timeoutMs: 0 })).toMatchObject({
      id: "context_after_timeout",
      kind: "context_message",
    });
  });

  it("drains queued context messages into the next model turn before sampling", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const seenMessages: LLMMessage[][] = [];
    const runId = "run_mailbox_context";

    await mailbox.publish({
      id: "msg_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "context_message",
      source: "operator",
      message: {
        role: "user",
        content: "Use the mailbox hint when answering.",
      },
    });

    const result = await runAgentLoop(
      createChatProvider(async (messages) => {
        seenMessages.push(messages);
        return "done";
      }),
      { goal: "Answer using the most recent user input" },
      [],
      {
        runId,
        mailbox,
      },
    );

    expect(result.status).toBe("completed");
    expect(seenMessages).toHaveLength(1);
    expect(
      seenMessages[0]?.some(
        (message) =>
          message.role === "user" &&
          message.content.includes("Use the mailbox hint"),
      ),
    ).toBe(true);
  });

  it("consumes mailbox control signals while waiting on tasks and cancels the run", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const runId = "run_mailbox_control";
    let observedAbortReason: string | undefined;

    const waitTask: AgentTask = {
      name: "wait_forever",
      description: "waits until aborted",
      kind: "workflow",
      async execute(_args, context) {
        await new Promise<never>((_, reject) => {
          context.signal.addEventListener(
            "abort",
            () => {
              observedAbortReason =
                typeof context.signal.reason === "string"
                  ? context.signal.reason
                  : String(context.signal.reason ?? "aborted");
              reject(new Error(observedAbortReason));
            },
            { once: true },
          );
        });
      },
    };

    const resultPromise = runAgentLoop(
      createChatProvider(async () =>
        JSON.stringify({ tool: "wait_forever", arguments: {} }),
      ),
      {
        goal: "wait",
        tasks: [waitTask],
      },
      [],
      {
        runId,
        mailbox,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    await mailbox.publish({
      id: "control_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "control_signal",
      action: "cancel",
      reason: "operator canceled the task wait",
    });

    const result = await resultPromise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result.status).toBe("canceled");
    expect(result.result).toBe("operator canceled the task wait");
    expect(String(observedAbortReason)).toContain("Task wait canceled");
    expect(result.taskCalls).toEqual([]);
  });

  it("turns trigger, system, progress, and out-of-band task mailbox messages into next-turn context instead of dropping them", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const runId = "run_mailbox_passthrough";
    const seenMessages: LLMMessage[][] = [];

    await mailbox.publish({
      id: "trigger_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "trigger",
      trigger: {
        type: "cron",
        source: "scheduler",
        metadata: { schedule: "nightly" },
      },
    });
    await mailbox.publish({
      id: "system_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "runtime.recovered",
      detail: { attempt: 2 },
    });
    await mailbox.publish({
      id: "progress_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "tool_progress",
      tool: "crawl",
      requestId: "toolreq_1",
      order: 0,
      message: "Fetched 12 pages",
      detail: { percent: 50 },
    });
    await mailbox.publish({
      id: "task_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "task_notification",
      notification: {
        runId,
        taskId: "task_1",
        requestId: "req_1",
        name: "background_sync",
        kind: "workflow",
        order: 1,
        status: "completed",
        args: { job: "sync" },
        result: { synced: true },
        hardFailure: false,
      },
    });

    const result = await runAgentLoop(
      createChatProvider(async (messages) => {
        seenMessages.push(messages);
        return "done";
      }),
      { goal: "consume mailbox events" },
      [],
      {
        runId,
        mailbox,
      },
    );

    expect(result.status).toBe("completed");
    const flattened = seenMessages[0]?.map((message) => message.content).join("\n") ?? "";
    expect(flattened).toContain("Runtime trigger: cron");
    expect(flattened).toContain("source=scheduler");
    expect(flattened).toContain("Runtime system event: runtime.recovered");
    expect(flattened).toContain("Tool progress for crawl: Fetched 12 pages");
    expect(flattened).toContain('Background task "background_sync" completed');
  });

  it("keeps non-control mailbox messages visible while waiting on tasks instead of discarding them", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const runId = "run_mailbox_task_wait_passthrough";
    const sampledMessages: LLMMessage[][] = [];

    const waitTask: AgentTask = {
      name: "wait_once",
      description: "waits until a background completion is published",
      kind: "workflow",
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true };
      },
    };

    const resultPromise = runAgentLoop(
      createChatProvider(async (messages) => {
        sampledMessages.push(messages);
        return sampledMessages.length === 1
          ? JSON.stringify({ tool: "wait_once", arguments: {} })
          : "done";
      }),
      { goal: "wait on task then continue", tasks: [waitTask] },
      [],
      { runId, mailbox },
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    await mailbox.publish({
      id: "progress_wait_1",
      runId,
      createdAt: new Date().toISOString(),
      kind: "system",
      event: "operator.note",
      detail: { note: "keep going" },
    });

    const result = await resultPromise;
    expect(result.status).toBe("completed");
    expect(sampledMessages).toHaveLength(2);
    expect(
      sampledMessages[1]?.some(
        (message) =>
          message.role === "user" &&
          message.content.includes("Runtime system event: operator.note"),
      ),
    ).toBe(true);
  });

  it("persists a paused checkpoint when a mailbox control signal arrives before the next model turn", async () => {
    const mailbox = new InMemoryAgentLoopMailbox();
    const runId = "run_mailbox_pre_turn_pause";
    const seenCheckpointStages: string[] = [];
    const sidecarStages: string[] = [];

    await mailbox.publish({
      id: "control_pre_turn",
      runId,
      createdAt: new Date().toISOString(),
      kind: "control_signal",
      action: "pause",
      reason: "pause before sampling",
    });

    const result = await runAgentLoop(
      createChatProvider(async () => {
        throw new Error("model should not be sampled after pre-turn pause");
      }),
      { goal: "pause before turn" },
      [],
      {
        runId,
        mailbox,
        hasPendingSidecars: () => true,
        runSidecars: async (request) => {
          sidecarStages.push(request.stage);
          return {};
        },
        onCheckpoint: async (checkpoint) => {
          seenCheckpointStages.push(checkpoint.stage);
          return checkpoint;
        },
      },
    );

    expect(result.status).toBe("paused");
    expect(result.result).toBeNull();
    expect(result.checkpoint?.stage).toBe("paused");
    expect(seenCheckpointStages).toContain("initialized");
    expect(seenCheckpointStages).toContain("paused");
    expect(sidecarStages).toEqual(["paused"]);
  });
});
