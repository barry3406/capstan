import { describe, expect, it } from "bun:test";

import {
  createGrant,
  grantApprovalActions,
  grantApprovalCollectionActions,
  grantArtifactActions,
  grantCheckpointActions,
  grantContextActions,
  grantEventActions,
  grantEventCollectionActions,
  grantMemoryActions,
  grantRunActions,
  grantRunCollectionActions,
  grantRuntimePathsActions,
  grantSummaryActions,
  grantSummaryCollectionActions,
  grantTaskActions,
} from "@zauso-ai/capstan-auth";

describe("auth runtime grants extra coverage", () => {
  it("keeps createGrant options intact for effect, expiry, constraints, and scope", () => {
    expect(
      createGrant("approval", "approve", {
        scope: { runId: "run-1", approvalId: "approval-1" },
        expiresAt: "2026-04-05T00:00:00.000Z",
        constraints: { actorKind: "user" },
        effect: "deny",
      }),
    ).toEqual({
      resource: "approval",
      action: "approve",
      scope: { runId: "run-1", approvalId: "approval-1" },
      expiresAt: "2026-04-05T00:00:00.000Z",
      constraints: { actorKind: "user" },
      effect: "deny",
    });
  });

  it("creates approval grants with the expected scope combinations", () => {
    expect(grantApprovalActions(["approve"])).toEqual([
      { resource: "approval", action: "approve" },
    ]);
    expect(
      grantApprovalActions(["read"], { runId: "run-1" }),
    ).toEqual([
      {
        resource: "approval",
        action: "read",
        scope: { runId: "run-1" },
      },
    ]);
    expect(
      grantApprovalActions(["manage"], {
        approvalId: "approval-1",
        runId: "run-1",
        tool: "ticket.delete",
      }),
    ).toEqual([
      {
        resource: "approval",
        action: "manage",
        scope: {
          approvalId: "approval-1",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
    ]);
  });

  it("creates collection grants without leaking record-level fields", () => {
    expect(grantRunCollectionActions(["start", "list"])).toEqual([
      { resource: "run", action: "start" },
      { resource: "run", action: "list" },
    ]);
    expect(grantApprovalCollectionActions(["list"])).toEqual([
      { resource: "approval", action: "list" },
    ]);
    expect(grantApprovalCollectionActions(["list"], { runId: "run-2" })).toEqual([
      {
        resource: "approval",
        action: "list",
        scope: { runId: "run-2" },
      },
    ]);
    expect(grantEventCollectionActions(["list"])).toEqual([
      { resource: "event", action: "list" },
    ]);
    expect(grantSummaryCollectionActions(["list"])).toEqual([
      { resource: "summary", action: "list" },
    ]);
    expect(grantRuntimePathsActions(["read"])).toEqual([
      { resource: "runtime_paths", action: "read" },
    ]);
  });

  it("creates run-scoped read surfaces with stable resource names", () => {
    expect(grantArtifactActions("run-1", ["read"], "artifact-1")).toEqual([
      {
        resource: "artifact",
        action: "read",
        scope: { runId: "run-1", artifactId: "artifact-1" },
      },
    ]);
    expect(grantCheckpointActions("run-1")).toEqual([
      {
        resource: "checkpoint",
        action: "read",
        scope: { runId: "run-1" },
      },
    ]);
    expect(grantEventActions("run-1")).toEqual([
      {
        resource: "event",
        action: "read",
        scope: { runId: "run-1" },
      },
    ]);
    expect(grantTaskActions("run-1", ["read"], "task-1")).toEqual([
      {
        resource: "task",
        action: "read",
        scope: { runId: "run-1", taskId: "task-1" },
      },
    ]);
    expect(grantSummaryActions("run-1", ["read"], "summary-1")).toEqual([
      {
        resource: "summary",
        action: "read",
        scope: { runId: "run-1", summaryId: "summary-1" },
      },
    ]);
    expect(grantContextActions("run-1")).toEqual([
      {
        resource: "context",
        action: "read",
        scope: { runId: "run-1" },
      },
    ]);
  });

  it("creates memory grants with and without scope while preserving partial scope", () => {
    expect(grantMemoryActions(["read"])).toEqual([
      { resource: "memory", action: "read" },
    ]);
    expect(grantMemoryActions(["write"], { runId: "run-1" })).toEqual([
      {
        resource: "memory",
        action: "write",
        scope: { runId: "run-1" },
      },
    ]);
    expect(grantMemoryActions(["read"], { memoryId: "memory-7" })).toEqual([
      {
        resource: "memory",
        action: "read",
        scope: { memoryId: "memory-7" },
      },
    ]);
    expect(
      grantMemoryActions(["read"], { runId: "run-1", memoryId: "memory-7" }),
    ).toEqual([
      {
        resource: "memory",
        action: "read",
        scope: { runId: "run-1", memoryId: "memory-7" },
      },
    ]);
  });

  it("allows custom action subsets without adding default extras", () => {
    expect(grantRunActions("run-1", ["resume"])).toEqual([
      {
        resource: "run",
        action: "resume",
        scope: { runId: "run-1" },
      },
    ]);
    expect(grantApprovalActions(["deny"], { approvalId: "approval-9" })).toEqual([
      {
        resource: "approval",
        action: "deny",
        scope: { approvalId: "approval-9" },
      },
    ]);
    expect(grantEventCollectionActions(["list"])).toHaveLength(1);
  });
});
