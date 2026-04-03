import { describe, expect, it } from "bun:test";
import {
  createHarnessGrantAuthorizer,
  grantApprovalActions,
  grantApprovalCollectionActions,
  grantRunActions,
  grantRuntimePathsActions,
  toRuntimeGrantRequest,
} from "@zauso-ai/capstan-auth";

describe("auth harness authorizer edge cases", () => {
  it("drops malformed nested approval payloads instead of leaking them into list scopes", () => {
    expect(
      toRuntimeGrantRequest({
        action: "approval:list",
        runId: "run-9",
        detail: {
          approvalId: "approval-9",
          tool: "ticket.delete",
          pendingApproval: ["not", "an", "object"] as unknown as Record<string, unknown>,
          pendingToolCall: { tool: "should-not-matter" },
        },
      }),
    ).toEqual({
      action: "approval:list",
      scope: {
        runId: "run-9",
      },
    });
  });

  it("prefers approval detail fields but still recovers from nested pending approval snapshots", () => {
    expect(
      toRuntimeGrantRequest({
        action: "approval:approve",
        runId: "run-10",
        detail: {
          approvalId: "approval-10",
          kind: "task",
          pendingApproval: {
            id: "approval-11",
            kind: "tool",
            tool: "release.deploy",
          },
          pendingToolCall: {
            tool: "ignored.by.pendingApproval",
          },
        },
      }),
    ).toEqual({
      action: "approval:approve",
      scope: {
        runId: "run-10",
        approvalId: "approval-10",
        tool: "release.deploy",
      },
      attributes: {
        approvalKind: "task",
      },
    });
  });

  it("uses nested tool names when the top-level approval detail omits tool", async () => {
    const authorizer = createHarnessGrantAuthorizer([
      ...grantApprovalActions(["approve"], {
        approvalId: "approval-12",
        runId: "run-11",
        tool: "release.deploy",
      }),
    ]);

    await expect(
      authorizer({
        action: "approval:approve",
        runId: "run-11",
        detail: {
          approvalId: "approval-12",
          kind: "task",
          pendingApproval: {
            id: "approval-12",
            kind: "task",
            tool: "release.deploy",
          },
          pendingToolCall: {
            tool: "should-not-leak",
          },
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "approve",
        scope: {
          approvalId: "approval-12",
          runId: "run-11",
          tool: "release.deploy",
        },
      },
    });
  });

  it("keeps approval collection grants and runtime paths grants isolated from run grants", async () => {
    const authorizer = createHarnessGrantAuthorizer([
      ...grantApprovalCollectionActions(["list"], { runId: "run-1" }),
      ...grantRuntimePathsActions(),
      ...grantRunActions("run-1", ["read"]),
    ]);

    await expect(
      authorizer({ action: "approval:list", runId: "run-1" }),
    ).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "list",
        scope: { runId: "run-1" },
      },
    });

    await expect(
      authorizer({ action: "approval:list", runId: "run-2" }),
    ).resolves.toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "approval",
        action: "list",
        scope: { runId: "run-2" },
      },
    });

    await expect(
      authorizer({ action: "runtime_paths:read" }),
    ).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "runtime_paths", action: "read" },
    });

    await expect(
      authorizer({ action: "run:list" }),
    ).resolves.toMatchObject({
      allowed: false,
      matchedRequirement: { resource: "run", action: "list" },
    });
  });
});
