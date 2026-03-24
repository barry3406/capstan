import { describe, expect, it } from "vitest";
import {
  reduceHarnessEvent,
  serializeHarnessEvent,
  summarizeHarnessRun,
  type HarnessEvent,
  type HarnessRun
} from "../../packages/harness/src/index.ts";

function createStartEvent(): HarnessEvent {
  return {
    id: "event-1",
    runId: "run-1",
    taskKey: "generateDigestTask",
    type: "run_started",
    actor: "agent",
    sequence: 1,
    at: "2026-03-22T00:00:00.000Z",
    status: "running",
    summary: "Started harness run.",
    payload: {
      taskTitle: "Generate Ticket Digest",
      attempt: 1,
      input: {
        ticketId: "ticket-1"
      }
    }
  };
}

function createRun(): HarnessRun {
  return {
    id: "run-1",
    taskKey: "generateDigestTask",
    taskTitle: "Generate Ticket Digest",
    status: "running",
    attempt: 1,
    input: {
      ticketId: "ticket-1"
    },
    createdAt: "2026-03-22T00:00:00.000Z",
    updatedAt: "2026-03-22T00:00:00.000Z",
    sequence: 1,
    lastEventId: "event-1"
  };
}

describe("harness", () => {
  it("reduces lifecycle events into durable run state", () => {
    const started = reduceHarnessEvent(undefined, createStartEvent());
    const approvalRequested = reduceHarnessEvent(started, {
      id: "event-2",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "approval_requested",
      actor: "agent",
      sequence: 2,
      at: "2026-03-22T00:01:00.000Z",
      status: "approval_required",
      summary: "Approval requested."
    });
    const approved = reduceHarnessEvent(approvalRequested, {
      id: "event-3",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "approval_granted",
      actor: "human",
      sequence: 3,
      at: "2026-03-22T00:02:00.000Z",
      status: "running",
      summary: "Approval granted."
    });
    const completed = reduceHarnessEvent(approved, {
      id: "event-4",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "run_completed",
      actor: "agent",
      sequence: 4,
      at: "2026-03-22T00:03:00.000Z",
      status: "completed",
      summary: "Completed.",
      payload: {
        artifactId: "digest-1"
      }
    });

    expect(started.status).toBe("running");
    expect(approvalRequested.status).toBe("approval_required");
    expect(approved.status).toBe("running");
    expect(completed.status).toBe("completed");
    expect(completed.output).toEqual({
      artifactId: "digest-1"
    });
  });

  it("increments attempts when failed runs are retried", () => {
    const failed = reduceHarnessEvent(createRun(), {
      id: "event-2",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "run_failed",
      actor: "agent",
      sequence: 2,
      at: "2026-03-22T00:01:00.000Z",
      status: "failed",
      summary: "Failed.",
      detail: "Network timeout"
    });
    const retried = reduceHarnessEvent(failed, {
      id: "event-3",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "run_retried",
      actor: "agent",
      sequence: 3,
      at: "2026-03-22T00:02:00.000Z",
      status: "running",
      summary: "Retried."
    });

    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Network timeout");
    expect(retried.status).toBe("running");
    expect(retried.attempt).toBe(2);
    expect(retried.error).toBeUndefined();
  });

  it("supports input handoff by moving into input_required and merging provided input", () => {
    const inputRequested = reduceHarnessEvent(createRun(), {
      id: "event-2",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "input_requested",
      actor: "agent",
      sequence: 2,
      at: "2026-03-22T00:01:00.000Z",
      status: "input_required",
      summary: "Input requested.",
      detail: "Need the digest window."
    });
    const inputReceived = reduceHarnessEvent(inputRequested, {
      id: "event-3",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "input_received",
      actor: "human",
      sequence: 3,
      at: "2026-03-22T00:02:00.000Z",
      status: "running",
      summary: "Input received.",
      detail: "Using the latest 24 hours.",
      payload: {
        input: {
          window: "24h",
          includeClosed: false
        }
      }
    });

    expect(inputRequested.status).toBe("input_required");
    expect(inputRequested.awaitingInput).toEqual({
      requestedAt: "2026-03-22T00:01:00.000Z",
      note: "Need the digest window."
    });
    expect(inputReceived.status).toBe("running");
    expect(inputReceived.awaitingInput).toBeUndefined();
    expect(inputReceived.input).toEqual({
      ticketId: "ticket-1",
      window: "24h",
      includeClosed: false
    });
    expect(inputReceived.lastProvidedInput).toEqual({
      at: "2026-03-22T00:02:00.000Z",
      actor: "human",
      note: "Using the latest 24 hours.",
      payload: {
        window: "24h",
        includeClosed: false
      }
    });
  });

  it("serializes harness events as ndjson lines", () => {
    const serialized = serializeHarnessEvent(createStartEvent());

    expect(serialized).toContain('"runId":"run-1"');
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("builds a compact runtime summary with checkpoint history and recent events", () => {
    const started = createStartEvent();
    const inputRequested: HarnessEvent = {
      id: "event-2",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "input_requested",
      actor: "agent",
      sequence: 2,
      at: "2026-03-22T00:01:00.000Z",
      status: "input_required",
      summary: "Input requested.",
      detail: "Need a digest window."
    };
    const inputReceived: HarnessEvent = {
      id: "event-3",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "input_received",
      actor: "human",
      sequence: 3,
      at: "2026-03-22T00:02:00.000Z",
      status: "running",
      summary: "Input received.",
      detail: "Use the last 24 hours.",
      payload: {
        input: {
          window: "24h"
        }
      }
    };
    const failed: HarnessEvent = {
      id: "event-4",
      runId: "run-1",
      taskKey: "generateDigestTask",
      type: "run_failed",
      actor: "agent",
      sequence: 4,
      at: "2026-03-22T00:03:00.000Z",
      status: "failed",
      summary: "Failed.",
      detail: "Digest provider timeout"
    };

    const afterStart = reduceHarnessEvent(undefined, started);
    const afterRequest = reduceHarnessEvent(afterStart, inputRequested);
    const afterInput = reduceHarnessEvent(afterRequest, inputReceived);
    const run = reduceHarnessEvent(afterInput, failed);

    const summary = summarizeHarnessRun("/tmp/capstan-app", run, [
      started,
      inputRequested,
      inputReceived,
      failed
    ], {
      consistent: true,
      tailWindow: 2
    });

    expect(summary.consistent).toBe(true);
    expect(summary.eventCount).toBe(4);
    expect(summary.tailWindow).toBe(2);
    expect(summary.recentEvents.map((event) => event.type)).toEqual([
      "input_received",
      "run_failed"
    ]);
    expect(summary.inputKeys).toEqual(["ticketId", "window"]);
    expect(summary.checkpointHistory).toEqual([
      {
        type: "input",
        requestedAt: "2026-03-22T00:01:00.000Z",
        note: "Need a digest window.",
        resolvedAt: "2026-03-22T00:02:00.000Z",
        resolvedBy: "human",
        resolution: "provided"
      }
    ]);
    expect(summary.activeCheckpoint).toBeUndefined();
    expect(summary.operatorBrief).toContain('is failed on attempt 1');
    expect(summary.error).toBe("Digest provider timeout");
  });
});
