import { describe, expect, it } from "bun:test";
import {
  authorizeRuntimeAction,
  createGrant,
  createRuntimeGrantAuthorizer,
  deriveRuntimeGrantRequirements,
  grantApprovalActions,
  grantApprovalCollectionActions,
  grantContextActions,
  grantMemoryActions,
  grantRunActions,
  grantRunCollectionActions,
  grantRuntimePathsActions,
} from "@zauso-ai/capstan-auth";

function summarizeRequirements(
  requirements: ReturnType<typeof deriveRuntimeGrantRequirements>,
): Array<{ resource: string; action: string; scope?: Record<string, string> }> {
  return requirements.map((requirement) => ({
    resource: requirement.resource,
    action: requirement.action,
    ...(requirement.scope ? { scope: requirement.scope } : {}),
  }));
}

describe("auth runtime authorizer", () => {
  it("derives the full fallback ladder for run-scoped read surfaces", () => {
    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "checkpoint:read",
          scope: { runId: "run-1", summaryId: "summary-1" },
        }),
      ),
    ).toEqual([
      { resource: "checkpoint", action: "read", scope: { runId: "run-1", summaryId: "summary-1" } },
      { resource: "run", action: "read", scope: { runId: "run-1" } },
    ]);

    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "artifact:read",
          scope: { runId: "run-1", artifactId: "artifact-9" },
        }),
      ),
    ).toEqual([
      { resource: "artifact", action: "read", scope: { runId: "run-1", artifactId: "artifact-9" } },
      { resource: "run", action: "read", scope: { runId: "run-1" } },
    ]);

    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "event:read",
          scope: { runId: "run-1" },
        }),
      ),
    ).toEqual([
      { resource: "event", action: "read", scope: { runId: "run-1" } },
      { resource: "run", action: "read", scope: { runId: "run-1" } },
    ]);

    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "task:read",
          scope: { runId: "run-1", taskId: "task-7" },
        }),
      ),
    ).toEqual([
      { resource: "task", action: "read", scope: { runId: "run-1", taskId: "task-7" } },
      { resource: "run", action: "read", scope: { runId: "run-1" } },
    ]);

    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "context:read",
          scope: { runId: "run-1" },
        }),
      ),
    ).toEqual([
      { resource: "context", action: "read", scope: { runId: "run-1" } },
      { resource: "run", action: "read", scope: { runId: "run-1" } },
    ]);
  });

  it("keeps summary and memory reads on the correct fallback chain", () => {
    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "summary:read",
          scope: { runId: "run-1", summaryId: "summary-1" },
        }),
      ),
    ).toEqual([
      { resource: "summary", action: "read", scope: { runId: "run-1", summaryId: "summary-1" } },
      { resource: "context", action: "read", scope: { runId: "run-1" } },
      { resource: "run", action: "read", scope: { runId: "run-1" } },
    ]);

    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "memory:read",
          scope: { runId: "run-1", memoryId: "memory-2" },
          attributes: { memoryKind: "session" },
        }),
      ),
    ).toEqual([
      { resource: "memory", action: "read", scope: { runId: "run-1", memoryId: "memory-2" } },
      { resource: "context", action: "read", scope: { runId: "run-1" } },
      { resource: "run", action: "read", scope: { runId: "run-1" } },
    ]);

    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "memory:read",
          scope: { runId: "run-1", memoryId: "memory-3" },
          attributes: { memoryKind: "persistent" },
        }),
      ),
    ).toEqual([
      { resource: "memory", action: "read", scope: { runId: "run-1", memoryId: "memory-3" } },
    ]);

    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "memory:read",
          scope: { memoryId: "memory-4" },
          attributes: { memoryKind: "session" },
        }),
      ),
    ).toEqual([
      { resource: "memory", action: "read", scope: { memoryId: "memory-4" } },
    ]);
  });

  it("keeps list actions distinct from read actions", () => {
    const readOnlyRunGrants = [createGrant("run", "read")];
    const listOnlyRunGrants = grantRunCollectionActions(["list"]);

    expect(
      authorizeRuntimeAction({ action: "run:list" }, readOnlyRunGrants),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: { resource: "run", action: "list" },
    });

    expect(
      authorizeRuntimeAction({ action: "run:list" }, listOnlyRunGrants),
    ).toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "run", action: "list" },
    });

    expect(
      authorizeRuntimeAction(
        { action: "approval:list", scope: { approvalId: "approval-1", runId: "run-1" } },
        grantApprovalActions(["manage"], {
          approvalId: "approval-1",
          runId: "run-1",
        }),
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "approval",
        action: "list",
        scope: { approvalId: "approval-1", runId: "run-1" },
      },
    });

    expect(
      authorizeRuntimeAction(
        { action: "approval:list", scope: { approvalId: "approval-1", runId: "run-1" } },
        [createGrant("approval", "list", { scope: { approvalId: "approval-1", runId: "run-1" } })],
      ),
    ).toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "list",
        scope: { approvalId: "approval-1", runId: "run-1" },
      },
    });
  });

  it("authorizes approvals through approval:manage fallback and preserves approval scopes", () => {
    const scopedManage = grantApprovalActions(["manage"], {
      approvalId: "approval-7",
      runId: "run-1",
      tool: "ticket.delete",
    });

    const approvalReadDecision = authorizeRuntimeAction(
      {
        action: "approval:read",
        scope: {
          approvalId: "approval-7",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
      scopedManage,
    );

    expect(approvalReadDecision).toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "manage",
        scope: {
          approvalId: "approval-7",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
    });

    const approvalApproveDecision = authorizeRuntimeAction(
      {
        action: "approval:approve",
        scope: {
          approvalId: "approval-7",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
      scopedManage,
    );

    expect(approvalApproveDecision).toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "manage",
        scope: {
          approvalId: "approval-7",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
    });

    expect(
      authorizeRuntimeAction(
        {
          action: "approval:approve",
          scope: {
            approvalId: "approval-7",
            runId: "run-1",
            tool: "ticket.delete",
          },
        },
        [createGrant("approval", "approve", {
          scope: {
            approvalId: "approval-7",
            runId: "run-1",
            tool: "ticket.delete",
          },
          effect: "deny",
        })],
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "approval",
        action: "approve",
        scope: {
          approvalId: "approval-7",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
      matchedGrant: { effect: "deny" },
    });
  });

  it("honors fallback denial before later requirements can allow access", () => {
    const decision = authorizeRuntimeAction(
      {
        action: "summary:read",
        scope: {
          runId: "run-1",
          summaryId: "summary-1",
        },
      },
      [
        ...grantContextActions("run-1"),
        createGrant("context", "read", {
          scope: { runId: "run-1" },
          effect: "deny",
        }),
        ...grantRunActions("run-1", ["read"]),
      ],
    );

    expect(decision).toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "context",
        action: "read",
        scope: { runId: "run-1" },
      },
      matchedGrant: { effect: "deny" },
    });
  });

  it("lets run:read satisfy read-only runtime surfaces without leaking into list actions", () => {
    const runRead = grantRunActions("run-1", ["read"]);

    expect(
      authorizeRuntimeAction(
        { action: "checkpoint:read", scope: { runId: "run-1" } },
        runRead,
      ),
    ).toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "run", action: "read", scope: { runId: "run-1" } },
    });

    expect(
      authorizeRuntimeAction(
        { action: "event:read", scope: { runId: "run-1" } },
        runRead,
      ),
    ).toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "run", action: "read", scope: { runId: "run-1" } },
    });

    expect(
      authorizeRuntimeAction(
        { action: "approval:list", scope: { runId: "run-1" } },
        runRead,
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: { resource: "approval", action: "list", scope: { runId: "run-1" } },
    });
  });

  it("keeps blank scope values out of derived runtime requirements", () => {
    expect(
      summarizeRequirements(
        deriveRuntimeGrantRequirements({
          action: "checkpoint:read",
          scope: {
            runId: "   ",
            artifactId: "artifact-1",
          },
        }),
      ),
    ).toEqual([
      { resource: "checkpoint", action: "read", scope: { artifactId: "artifact-1" } },
      { resource: "run", action: "read" },
    ]);
  });

  it("treats collection list actions as distinct from read-style grants", () => {
    const listOnly = grantApprovalCollectionActions(["list"], { runId: "run-1" });

    expect(
      authorizeRuntimeAction(
        { action: "approval:list", scope: { runId: "run-1" } },
        listOnly,
      ),
    ).toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "list",
        scope: { runId: "run-1" },
      },
    });

    expect(
      authorizeRuntimeAction(
        { action: "approval:list", scope: { runId: "run-2" } },
        listOnly,
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "approval",
        action: "list",
        scope: { runId: "run-2" },
      },
    });

    expect(
      authorizeRuntimeAction(
        { action: "summary:list" },
        grantRunActions("run-1", ["read"]),
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: { resource: "summary", action: "list" },
    });
  });

  it("authorizes runtime_paths separately from run-scoped grants", () => {
    expect(
      authorizeRuntimeAction(
        { action: "runtime_paths:read" },
        grantRuntimePathsActions(),
      ),
    ).toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "runtime_paths", action: "read" },
    });

    expect(
      authorizeRuntimeAction(
        { action: "runtime_paths:write" },
        grantRuntimePathsActions(),
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: { resource: "runtime_paths", action: "write" },
    });
  });

  it("does not escalate persistent memory reads into context or run grants", () => {
    expect(
      authorizeRuntimeAction(
        {
          action: "memory:read",
          scope: { runId: "run-1", memoryId: "memory-1" },
          attributes: { memoryKind: "persistent" },
        },
        grantContextActions("run-1"),
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "memory",
        action: "read",
        scope: { runId: "run-1", memoryId: "memory-1" },
      },
    });

    expect(
      authorizeRuntimeAction(
        {
          action: "memory:read",
          scope: { runId: "run-1", memoryId: "memory-1" },
          attributes: { memoryKind: "persistent" },
        },
        grantRunActions("run-1", ["read"]),
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "memory",
        action: "read",
        scope: { runId: "run-1", memoryId: "memory-1" },
      },
    });
  });

  it("keeps approval deny flows on the approval namespace and allows manage as the only fallback", () => {
    const manage = grantApprovalActions(["manage"], {
      approvalId: "approval-11",
      runId: "run-1",
      tool: "ticket.delete",
    });

    expect(
      authorizeRuntimeAction(
        {
          action: "approval:deny",
          scope: {
            approvalId: "approval-11",
            runId: "run-1",
            tool: "ticket.delete",
          },
        },
        manage,
      ),
    ).toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "manage",
        scope: {
          approvalId: "approval-11",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
    });

    expect(
      authorizeRuntimeAction(
        {
          action: "approval:deny",
          scope: {
            approvalId: "approval-11",
            runId: "run-1",
            tool: "ticket.delete",
          },
        },
        [createGrant("approval", "list", {
          scope: {
            approvalId: "approval-11",
            runId: "run-1",
            tool: "ticket.delete",
          },
        })],
      ),
    ).toMatchObject({
      allowed: false,
      matchedRequirement: {
        resource: "approval",
        action: "deny",
        scope: {
          approvalId: "approval-11",
          runId: "run-1",
          tool: "ticket.delete",
        },
      },
    });
  });

  it("supports async grant suppliers and re-evaluates grants on each request", async () => {
    let currentGrants = grantRunCollectionActions(["list"]);
    const authorizer = createRuntimeGrantAuthorizer(async () => currentGrants);

    await expect(authorizer({ action: "run:list" })).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "run", action: "list" },
    });

    currentGrants = grantRunActions("run-1");

    await expect(
      authorizer({ action: "run:list", scope: { runId: "run-1" } }),
    ).resolves.toMatchObject({
      allowed: false,
      matchedRequirement: { resource: "run", action: "list", scope: { runId: "run-1" } },
    });

    await expect(
      authorizer({
        action: "memory:read",
        scope: { runId: "run-1", memoryId: "memory-1" },
        attributes: { memoryKind: "session" },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "run", action: "read", scope: { runId: "run-1" } },
    });

    currentGrants = grantApprovalActions(["manage"], {
      approvalId: "approval-9",
      runId: "run-1",
      tool: "ticket.create",
    });

    await expect(
      authorizer({
        action: "approval:approve",
        scope: {
          approvalId: "approval-9",
          runId: "run-1",
          tool: "ticket.create",
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: {
        resource: "approval",
        action: "manage",
        scope: {
          approvalId: "approval-9",
          runId: "run-1",
          tool: "ticket.create",
        },
      },
    });
  });
});
