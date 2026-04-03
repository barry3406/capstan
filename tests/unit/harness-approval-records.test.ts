import { describe, expect, it } from "bun:test";

import { assertValidApprovalRecord } from "../../packages/ai/src/harness/runtime/approval-records.ts";
import type { HarnessApprovalRecord } from "../../packages/ai/src/harness/types.ts";

function createApprovalRecord(
  patch: Partial<HarnessApprovalRecord> = {},
): HarnessApprovalRecord {
  return {
    id: "approval-1",
    runId: "run-1",
    kind: "tool",
    tool: "ticket.delete",
    args: { id: "123" },
    reason: "delete requires approval",
    requestedAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    status: "pending",
    ...patch,
  };
}

describe("assertValidApprovalRecord", () => {
  it("accepts a valid pending tool approval", () => {
    const record = createApprovalRecord();

    expect(() => assertValidApprovalRecord(record.id, record)).not.toThrow();
  });

  it("accepts pending approvals with extra resolvedBy metadata already attached", () => {
    const record = createApprovalRecord({
      resolvedBy: {
        id: "operator-2",
        kind: "user",
        role: "ops",
      },
    });

    expect(() => assertValidApprovalRecord(record.id, record)).not.toThrow();
  });

  it("accepts terminal task approvals with resolution metadata", () => {
    const approved = createApprovalRecord({
      id: "approval-2",
      kind: "task",
      tool: "deploy.release",
      status: "approved",
      resolvedAt: "2026-04-04T00:05:00.000Z",
      resolutionNote: "ship it",
      resolvedBy: {
        id: "operator-1",
        role: "ops",
      },
    });
    const denied = createApprovalRecord({
      id: "approval-3",
      status: "denied",
      resolvedAt: "2026-04-04T00:05:00.000Z",
    });
    const canceled = createApprovalRecord({
      id: "approval-4",
      status: "canceled",
      resolvedAt: "2026-04-04T00:05:00.000Z",
      resolutionNote: "run canceled by operator",
    });

    expect(() => assertValidApprovalRecord(approved.id, approved)).not.toThrow();
    expect(() => assertValidApprovalRecord(denied.id, denied)).not.toThrow();
    expect(() => assertValidApprovalRecord(canceled.id, canceled)).not.toThrow();
  });

  it("accepts terminal approvals with nested metadata payloads intact", () => {
    const record = createApprovalRecord({
      id: "approval-5",
      status: "approved",
      resolvedAt: "2026-04-04T00:05:00.000Z",
      resolvedBy: {
        id: "operator-3",
        kind: "agent",
        session: {
          id: "session-1",
          source: "cli",
        },
      },
      resolutionNote: "looks good",
      args: {
        nested: {
          steps: ["review", "approve"],
        },
      },
    });

    expect(() => assertValidApprovalRecord(record.id, record)).not.toThrow();
  });

  it("rejects non-object payloads and identifier mismatches", () => {
    expect(() => assertValidApprovalRecord("approval-1", null)).toThrow(
      'Harness approval approval-1 is invalid: expected object',
    );
    expect(() => assertValidApprovalRecord("approval-1", [] as unknown)).toThrow(
      'Harness approval approval-1 is invalid: expected object',
    );
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({ id: "approval-other" }) as unknown,
      ),
    ).toThrow('Harness approval approval-1 is invalid: expected id "approval-1"');
  });

  it("rejects blank runId, tool, and reason fields", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({ runId: "  " }) as unknown,
      ),
    ).toThrow("runId must be a non-empty string");
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({ tool: "" }) as unknown,
      ),
    ).toThrow("tool must be a non-empty string");
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({ reason: "" }) as unknown,
      ),
    ).toThrow("reason must be a non-empty string");
  });

  it("rejects blank updatedAt and malformed resolvedBy values", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({ updatedAt: " " }) as unknown,
      ),
    ).toThrow("updatedAt must be a string");
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({
          status: "approved",
          resolvedAt: "2026-04-04T00:05:00.000Z",
          resolvedBy: [] as unknown as Record<string, unknown>,
        }) as unknown,
      ),
    ).toThrow("resolvedBy must be an object when present");
  });

  it("rejects unsupported approval kinds and statuses", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        { ...createApprovalRecord(), kind: "workflow" } as unknown,
      ),
    ).toThrow("kind is unsupported");
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        { ...createApprovalRecord(), status: "waiting" } as unknown,
      ),
    ).toThrow("status is unsupported");
  });

  it("rejects pending approvals that are missing a requestedAt timestamp", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({ requestedAt: "   " }) as unknown,
      ),
    ).toThrow("requestedAt must be a string");
  });

  it("rejects non-ISO timestamps for requestedAt, updatedAt, and resolvedAt", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({ requestedAt: "not-a-date" }) as unknown,
      ),
    ).toThrow("requestedAt must be an ISO timestamp");
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({ updatedAt: "also-bad" }) as unknown,
      ),
    ).toThrow("updatedAt must be an ISO timestamp");
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({
          status: "approved",
          resolvedAt: "still-bad",
        }) as unknown,
      ),
    ).toThrow("resolvedAt must be an ISO timestamp when present");
  });

  it("rejects pending approvals that already contain terminal resolution fields", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({
          resolvedAt: "2026-04-04T00:05:00.000Z",
        }) as unknown,
      ),
    ).toThrow("pending approvals cannot have resolvedAt");
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({
          resolutionNote: "premature",
        }) as unknown,
      ),
    ).toThrow("pending approvals cannot have resolutionNote");
  });

  it("rejects terminal approvals that have a blank resolvedAt string", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({
          status: "approved",
          resolvedAt: "   ",
        }) as unknown,
      ),
    ).toThrow("resolvedAt must be a string when present");
  });

  it("rejects terminal approvals that omit resolvedAt", () => {
    for (const status of ["approved", "denied", "canceled"] as const) {
      expect(() =>
        assertValidApprovalRecord(
          "approval-1",
          createApprovalRecord({
            status,
            resolvedAt: undefined,
          }) as unknown,
        ),
      ).toThrow("terminal approvals require resolvedAt");
    }
  });

  it("rejects terminal approvals whose resolvedBy is not a plain object", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({
          status: "denied",
          resolvedAt: "2026-04-04T00:05:00.000Z",
          resolvedBy: ["operator-1"] as unknown as Record<string, unknown>,
        }) as unknown,
      ),
    ).toThrow("resolvedBy must be an object when present");
  });

  it("rejects malformed resolution metadata", () => {
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({
          status: "approved",
          resolvedAt: "2026-04-04T00:05:00.000Z",
          resolutionNote: 42 as unknown as string,
        }) as unknown,
      ),
    ).toThrow("resolutionNote must be a string when present");
    expect(() =>
      assertValidApprovalRecord(
        "approval-1",
        createApprovalRecord({
          status: "approved",
          resolvedAt: "2026-04-04T00:05:00.000Z",
          resolvedBy: "operator-1" as unknown as Record<string, unknown>,
        }) as unknown,
      ),
    ).toThrow("resolvedBy must be an object when present");
  });

  it("accepts terminal approvals with empty resolution notes when the record is otherwise valid", () => {
    const record = createApprovalRecord({
      status: "canceled",
      resolvedAt: "2026-04-04T00:05:00.000Z",
      resolutionNote: "",
    });

    expect(() => assertValidApprovalRecord(record.id, record)).not.toThrow();
  });

  it("accepts arbitrary args payloads without constraining their shape", () => {
    const record = createApprovalRecord({
      args: {
        nested: ["a", 1, { ok: true }],
      },
    });

    expect(() => assertValidApprovalRecord(record.id, record)).not.toThrow();
  });
});
