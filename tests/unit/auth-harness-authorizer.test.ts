import { describe, expect, it } from "bun:test";
import {
  createHarnessGrantAuthorizer,
  createGrant,
  toRuntimeGrantRequest,
  grantApprovalActions,
  grantApprovalCollectionActions,
  grantContextActions,
  grantRuntimePathsActions,
  grantRunActions,
  grantRunCollectionActions,
} from "@zauso-ai/capstan-auth";

describe("auth harness authorizer adapter", () => {
  it("maps flat approval detail into runtime scope and attributes", () => {
    expect(
      toRuntimeGrantRequest({
        action: "approval:approve",
        runId: "run-1",
        detail: {
          approvalId: "approval-7",
          tool: "ticket.delete",
          kind: "tool",
        },
      }),
    ).toEqual({
      action: "approval:approve",
      scope: {
        runId: "run-1",
        approvalId: "approval-7",
        tool: "ticket.delete",
      },
      attributes: {
        approvalKind: "tool",
      },
    });
  });

  it("maps nested pending approval and pending tool call detail into runtime scope", () => {
    expect(
      toRuntimeGrantRequest({
        action: "approval:read",
        runId: "run-2",
        detail: {
          pendingApproval: {
            id: "approval-9",
            kind: "task",
            tool: "deploy.release",
          },
          pendingToolCall: {
            tool: "deploy.release",
          },
        },
      }),
    ).toEqual({
      action: "approval:read",
      scope: {
        runId: "run-2",
        approvalId: "approval-9",
        tool: "deploy.release",
      },
      attributes: {
        approvalKind: "task",
      },
    });
  });

  it("maps session and persistent memory detail into the right runtime attributes", () => {
    expect(
      toRuntimeGrantRequest({
        action: "memory:read",
        runId: "run-3",
        detail: {
          kind: "session_memory",
          memoryId: "memory-1",
        },
      }),
    ).toEqual({
      action: "memory:read",
      scope: {
        runId: "run-3",
        memoryId: "memory-1",
      },
      attributes: {
        memoryKind: "session",
      },
    });

    expect(
      toRuntimeGrantRequest({
        action: "memory:read",
        detail: {
          kinds: ["persistent_memory"],
          memoryId: "memory-2",
        },
      }),
    ).toEqual({
      action: "memory:read",
      scope: {
        memoryId: "memory-2",
      },
      attributes: {
        memoryKind: "persistent",
      },
    });
  });

  it("treats list actions as collection gates instead of record-scoped reads", () => {
    expect(
      toRuntimeGrantRequest({
        action: "approval:list",
        runId: "run-4",
        detail: {
          approvalId: "approval-11",
          tool: "ticket.delete",
        },
      }),
    ).toEqual({
      action: "approval:list",
      scope: {
        runId: "run-4",
      },
    });
  });

  it("ignores blank scoped values instead of leaking empty keys into runtime requests", () => {
    expect(
      toRuntimeGrantRequest({
        action: "approval:read",
        runId: "run-6",
        detail: {
          approvalId: "   ",
          tool: "",
          pendingApproval: {
            id: "  ",
            tool: "   ",
            kind: "tool",
          },
        },
      }),
    ).toEqual({
      action: "approval:read",
      scope: {
        runId: "run-6",
      },
      attributes: {
        approvalKind: "tool",
      },
    });
  });

  it("prefers nested pending approval identifiers over unrelated pending tool payloads", () => {
    expect(
      toRuntimeGrantRequest({
        action: "approval:approve",
        runId: "run-7",
        detail: {
          pendingApproval: {
            id: "approval-77",
            tool: "deploy.release",
            kind: "task",
          },
          pendingToolCall: {
            tool: "ignored.tool",
          },
        },
      }),
    ).toEqual({
      action: "approval:approve",
      scope: {
        runId: "run-7",
        approvalId: "approval-77",
        tool: "deploy.release",
      },
      attributes: {
        approvalKind: "task",
      },
    });
  });

  it("does not invent memory attributes when kinds are mixed or unrelated", () => {
    expect(
      toRuntimeGrantRequest({
        action: "memory:read",
        runId: "run-8",
        detail: {
          kinds: ["session_memory", "persistent_memory"],
          memoryId: "memory-8",
        },
      }),
    ).toEqual({
      action: "memory:read",
      scope: {
        runId: "run-8",
        memoryId: "memory-8",
      },
    });
  });

  it("creates a harness authorizer that reuses runtime fallback rules", async () => {
    const authorizer = createHarnessGrantAuthorizer([
      ...grantRunCollectionActions(["list"]),
      ...grantRunActions("run-1", ["read"]),
      ...grantApprovalActions(["manage"], {
        approvalId: "approval-2",
        runId: "run-1",
        tool: "ticket.delete",
      }),
    ]);

    await expect(authorizer({ action: "run:list" })).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "run", action: "list" },
    });

    await expect(
      authorizer({
        action: "summary:read",
        runId: "run-1",
        detail: { summaryId: "summary-1" },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "run", action: "read", scope: { runId: "run-1" } },
    });

    await expect(
      authorizer({
        action: "approval:approve",
        runId: "run-1",
        detail: {
          approvalId: "approval-2",
          tool: "ticket.delete",
          kind: "tool",
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "manage",
        scope: {
          approvalId: "approval-2",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
    });
  });

  it("keeps runtime path reads isolated from run and approval grants", async () => {
    const authorizer = createHarnessGrantAuthorizer([
      ...grantRunCollectionActions(["list"]),
      ...grantApprovalCollectionActions(["list"], { runId: "run-9" }),
    ]);

    await expect(authorizer({ action: "runtime_paths:read" })).resolves.toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "runtime_paths",
        action: "read",
      },
    });

    const allowed = createHarnessGrantAuthorizer(grantRuntimePathsActions());
    await expect(allowed({ action: "runtime_paths:read" })).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "runtime_paths",
        action: "read",
      },
    });
  });

  it("preserves deny precedence after mapping harness request detail", async () => {
    const authorizer = createHarnessGrantAuthorizer([
      ...grantContextActions("run-5"),
      createGrant("context", "read", {
        scope: { runId: "run-5" },
        effect: "deny",
      }),
      ...grantRunActions("run-5", ["read"]),
    ]);

    await expect(
      authorizer({
        action: "summary:read",
        runId: "run-5",
        detail: { summaryId: "summary-7" },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "context",
        action: "read",
        scope: { runId: "run-5" },
      },
      matchedGrant: { effect: "deny" },
    });
  });
});
