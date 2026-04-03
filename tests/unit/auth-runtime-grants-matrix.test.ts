import { describe, expect, it } from "bun:test";

import {
  authorizeRuntimeAction,
  createGrant,
  createRuntimeGrantAuthorizer,
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

type GrantShape = {
  resource: string;
  action: string;
  scope?: Record<string, string>;
  effect?: "allow" | "deny";
  expiresAt?: string;
  constraints?: Record<string, unknown>;
};

describe("auth runtime grants matrix", () => {
  it("builds the helper families with stable shapes", () => {
    const cases: Array<{
      title: string;
      actual: () => GrantShape[];
      expected: GrantShape[];
    }> = [
      {
        title: "createGrant with every option",
        actual: () =>
          [
            createGrant("approval", "approve", {
              scope: { runId: "run-1", approvalId: "approval-1" },
              effect: "deny",
              expiresAt: "2026-04-05T00:00:00.000Z",
              constraints: { actorKind: "user", stage: "manual" },
            }),
          ],
        expected: [
          {
            resource: "approval",
            action: "approve",
            scope: { runId: "run-1", approvalId: "approval-1" },
            effect: "deny",
            expiresAt: "2026-04-05T00:00:00.000Z",
            constraints: { actorKind: "user", stage: "manual" },
          },
        ],
      },
      {
        title: "grantRunActions with a subset",
        actual: () => grantRunActions("run-1", ["read", "resume"]),
        expected: [
          { resource: "run", action: "read", scope: { runId: "run-1" } },
          { resource: "run", action: "resume", scope: { runId: "run-1" } },
        ],
      },
      {
        title: "grantRunCollectionActions",
        actual: () => grantRunCollectionActions(["start", "list"]),
        expected: [
          { resource: "run", action: "start" },
          { resource: "run", action: "list" },
        ],
      },
      {
        title: "grantApprovalActions with a fully scoped record",
        actual: () =>
          grantApprovalActions(["read", "manage"], {
            approvalId: "approval-1",
            runId: "run-1",
            tool: "ticket.delete",
          }),
        expected: [
          {
            resource: "approval",
            action: "read",
            scope: {
              approvalId: "approval-1",
              runId: "run-1",
              tool: "ticket.delete",
            },
          },
          {
            resource: "approval",
            action: "manage",
            scope: {
              approvalId: "approval-1",
              runId: "run-1",
              tool: "ticket.delete",
            },
          },
        ],
      },
      {
        title: "grantApprovalCollectionActions with and without run scope",
        actual: () => [
          ...grantApprovalCollectionActions(["list"]),
          ...grantApprovalCollectionActions(["list"], { runId: "run-2" }),
        ],
        expected: [
          { resource: "approval", action: "list" },
          { resource: "approval", action: "list", scope: { runId: "run-2" } },
        ],
      },
      {
        title: "grantArtifactActions keeps the artifact id attached",
        actual: () => grantArtifactActions("run-3", ["read"], "artifact-3"),
        expected: [
          {
            resource: "artifact",
            action: "read",
            scope: { runId: "run-3", artifactId: "artifact-3" },
          },
        ],
      },
      {
        title: "grantCheckpointActions stays run scoped",
        actual: () => grantCheckpointActions("run-4", ["read"]),
        expected: [
          { resource: "checkpoint", action: "read", scope: { runId: "run-4" } },
        ],
      },
      {
        title: "grantEventActions and grantEventCollectionActions stay distinct",
        actual: () => [
          ...grantEventActions("run-5", ["read"]),
          ...grantEventCollectionActions(["list"]),
        ],
        expected: [
          { resource: "event", action: "read", scope: { runId: "run-5" } },
          { resource: "event", action: "list" },
        ],
      },
      {
        title: "grantTaskActions keeps the task id attached",
        actual: () => grantTaskActions("run-6", ["read"], "task-6"),
        expected: [
          {
            resource: "task",
            action: "read",
            scope: { runId: "run-6", taskId: "task-6" },
          },
        ],
      },
      {
        title: "grantSummaryActions and grantSummaryCollectionActions",
        actual: () => [
          ...grantSummaryActions("run-7", ["read"], "summary-7"),
          ...grantSummaryCollectionActions(["list"]),
        ],
        expected: [
          {
            resource: "summary",
            action: "read",
            scope: { runId: "run-7", summaryId: "summary-7" },
          },
          { resource: "summary", action: "list" },
        ],
      },
      {
        title: "grantMemoryActions preserves both scoped and partial grants",
        actual: () => [
          ...grantMemoryActions(["read"]),
          ...grantMemoryActions(["write"], { runId: "run-8" }),
          ...grantMemoryActions(["read"], { memoryId: "memory-8" }),
          ...grantMemoryActions(["read"], {
            runId: "run-8",
            memoryId: "memory-8",
          }),
        ],
        expected: [
          { resource: "memory", action: "read" },
          { resource: "memory", action: "write", scope: { runId: "run-8" } },
          { resource: "memory", action: "read", scope: { memoryId: "memory-8" } },
          {
            resource: "memory",
            action: "read",
            scope: { runId: "run-8", memoryId: "memory-8" },
          },
        ],
      },
      {
        title: "grantContextActions and grantRuntimePathsActions",
        actual: () => [
          ...grantContextActions("run-9", ["read"]),
          ...grantRuntimePathsActions(["read"]),
        ],
        expected: [
          { resource: "context", action: "read", scope: { runId: "run-9" } },
          { resource: "runtime_paths", action: "read" },
        ],
      },
    ];

    for (const testCase of cases) {
      expect(testCase.actual()).toEqual(testCase.expected);
    }
  });

  it("keeps collection helpers free of record-level scope", () => {
    expect(grantApprovalCollectionActions(["list"])).toEqual([
      { resource: "approval", action: "list" },
    ]);
    expect(grantEventCollectionActions(["list"])).toEqual([
      { resource: "event", action: "list" },
    ]);
    expect(grantSummaryCollectionActions(["list"])).toEqual([
      { resource: "summary", action: "list" },
    ]);
    expect(grantRunCollectionActions(["start", "list"])).toEqual([
      { resource: "run", action: "start" },
      { resource: "run", action: "list" },
    ]);
    expect(grantRuntimePathsActions(["read"])).toEqual([
      { resource: "runtime_paths", action: "read" },
    ]);
  });

  it("authorizes string permissions and object grants with the same matrix", () => {
    const cases: Array<{
      title: string;
      request: Parameters<typeof authorizeRuntimeAction>[0];
      granted: Array<string | GrantShape>;
      expectedAllowed: boolean;
      expectedRequirement: GrantShape;
    }> = [
      {
        title: "run list with string grant",
        request: { action: "run:list" },
        granted: ["run:list"],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "list" },
      },
      {
        title: "run list denied by read-only string grant",
        request: { action: "run:list" },
        granted: ["run:read"],
        expectedAllowed: false,
        expectedRequirement: { resource: "run", action: "list" },
      },
      {
        title: "approval list requires an approval list grant even when read exists",
        request: { action: "approval:list", scope: { runId: "run-10" } },
        granted: ["approval:read"],
        expectedAllowed: false,
        expectedRequirement: { resource: "approval", action: "list", scope: { runId: "run-10" } },
      },
      {
        title: "approval list is satisfied by a scoped object grant",
        request: { action: "approval:list", scope: { runId: "run-10" } },
        granted: [
          createGrant("approval", "list", { scope: { runId: "run-10" } }),
        ],
        expectedAllowed: true,
        expectedRequirement: { resource: "approval", action: "list", scope: { runId: "run-10" } },
      },
      {
        title: "summary read falls back from summary to context to run",
        request: { action: "summary:read", scope: { runId: "run-11", summaryId: "summary-11" } },
        granted: [
          createGrant("context", "read", { scope: { runId: "run-11" } }),
        ],
        expectedAllowed: true,
        expectedRequirement: { resource: "context", action: "read", scope: { runId: "run-11" } },
      },
      {
        title: "memory read with session kind falls back to run grants",
        request: {
          action: "memory:read",
          scope: { runId: "run-12", memoryId: "memory-12" },
          attributes: { memoryKind: "session" },
        },
        granted: [
          createGrant("run", "read", { scope: { runId: "run-12" } }),
        ],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "read", scope: { runId: "run-12" } },
      },
      {
        title: "memory read with persistent kind does not fall back",
        request: {
          action: "memory:read",
          scope: { runId: "run-13", memoryId: "memory-13" },
          attributes: { memoryKind: "persistent" },
        },
        granted: ["run:read"],
        expectedAllowed: false,
        expectedRequirement: { resource: "memory", action: "read", scope: { runId: "run-13", memoryId: "memory-13" } },
      },
      {
        title: "runtime paths require a direct runtime_paths grant",
        request: { action: "runtime_paths:read" },
        granted: ["run:read", createGrant("runtime_paths", "read")],
        expectedAllowed: true,
        expectedRequirement: { resource: "runtime_paths", action: "read" },
      },
      {
        title: "direct deny beats later allow grants",
        request: { action: "approval:approve", scope: { runId: "run-14", approvalId: "approval-14", tool: "ticket.delete" } },
        granted: [
          createGrant("approval", "approve", {
            scope: { runId: "run-14", approvalId: "approval-14", tool: "ticket.delete" },
            effect: "deny",
          }),
          createGrant("approval", "manage", {
            scope: { runId: "run-14", approvalId: "approval-14", tool: "ticket.delete" },
          }),
        ],
        expectedAllowed: false,
        expectedRequirement: {
          resource: "approval",
          action: "approve",
          scope: { runId: "run-14", approvalId: "approval-14", tool: "ticket.delete" },
        },
      },
      {
        title: "fallback deny beats later run allow",
        request: { action: "summary:read", scope: { runId: "run-15", summaryId: "summary-15" } },
        granted: [
          createGrant("context", "read", {
            scope: { runId: "run-15" },
            effect: "deny",
          }),
          createGrant("run", "read", { scope: { runId: "run-15" } }),
        ],
        expectedAllowed: false,
        expectedRequirement: { resource: "context", action: "read", scope: { runId: "run-15" } },
      },
      {
        title: "collection grant does not satisfy record-level approval",
        request: {
          action: "approval:read",
          scope: { runId: "run-16", approvalId: "approval-16", tool: "ticket.delete" },
        },
        granted: [createGrant("approval", "list", { scope: { runId: "run-16" } })],
        expectedAllowed: false,
        expectedRequirement: {
          resource: "approval",
          action: "read",
          scope: { runId: "run-16", approvalId: "approval-16", tool: "ticket.delete" },
        },
      },
      {
        title: "run list is isolated from scoped run read",
        request: { action: "run:list" },
        granted: [createGrant("run", "read", { scope: { runId: "run-17" } })],
        expectedAllowed: false,
        expectedRequirement: { resource: "run", action: "list" },
      },
    ];

    for (const testCase of cases) {
      const decision = authorizeRuntimeAction(testCase.request, testCase.granted);
      expect(decision.allowed).toBe(testCase.expectedAllowed);
      expect(decision.matchedRequirement).toEqual(testCase.expectedRequirement);
    }
  });

  it("re-evaluates supplier output on every request and supports async suppliers", async () => {
    let callCount = 0;
    let grants: Array<string | GrantShape> = ["run:read"];
    const authorizer = createRuntimeGrantAuthorizer(async () => {
      callCount += 1;
      return grants;
    });

    await expect(authorizer({ action: "run:list" })).resolves.toMatchObject({
      allowed: false,
      matchedRequirement: { resource: "run", action: "list" },
    });

    grants = ["run:list"];
    await expect(authorizer({ action: "run:list" })).resolves.toMatchObject({
      allowed: true,
      matchedRequirement: { resource: "run", action: "list" },
    });

    grants = [
      createGrant("run", "list", {
        effect: "deny",
      }),
      createGrant("run", "list"),
    ];
    await expect(authorizer({ action: "run:list" })).resolves.toMatchObject({
      allowed: false,
      matchedRequirement: { resource: "run", action: "list" },
      matchedGrant: {
        resource: "run",
        action: "list",
        effect: "deny",
      },
    });

    expect(callCount).toBe(3);
  });

  it("covers the default action sets for every helper family", () => {
    const cases: Array<{
      title: string;
      actual: () => GrantShape[];
      expected: GrantShape[];
    }> = [
      {
        title: "grantRunActions defaults to read pause cancel resume",
        actual: () => grantRunActions("run-default"),
        expected: [
          { resource: "run", action: "read", scope: { runId: "run-default" } },
          { resource: "run", action: "pause", scope: { runId: "run-default" } },
          { resource: "run", action: "cancel", scope: { runId: "run-default" } },
          { resource: "run", action: "resume", scope: { runId: "run-default" } },
        ],
      },
      {
        title: "grantRunCollectionActions defaults to start and list",
        actual: () => grantRunCollectionActions(),
        expected: [
          { resource: "run", action: "start" },
          { resource: "run", action: "list" },
        ],
      },
      {
        title: "grantApprovalActions defaults to the four approval verbs",
        actual: () => grantApprovalActions(),
        expected: [
          { resource: "approval", action: "read" },
          { resource: "approval", action: "approve" },
          { resource: "approval", action: "deny" },
          { resource: "approval", action: "manage" },
        ],
      },
      {
        title: "grantApprovalCollectionActions defaults to list",
        actual: () => grantApprovalCollectionActions(),
        expected: [{ resource: "approval", action: "list" }],
      },
      {
        title: "grantArtifactActions defaults to read",
        actual: () => grantArtifactActions("run-default"),
        expected: [
          {
            resource: "artifact",
            action: "read",
            scope: { runId: "run-default" },
          },
        ],
      },
      {
        title: "grantCheckpointActions defaults to read",
        actual: () => grantCheckpointActions("run-default"),
        expected: [
          {
            resource: "checkpoint",
            action: "read",
            scope: { runId: "run-default" },
          },
        ],
      },
      {
        title: "grantEventActions defaults to read",
        actual: () => grantEventActions("run-default"),
        expected: [
          { resource: "event", action: "read", scope: { runId: "run-default" } },
        ],
      },
      {
        title: "grantEventCollectionActions defaults to list",
        actual: () => grantEventCollectionActions(),
        expected: [{ resource: "event", action: "list" }],
      },
      {
        title: "grantTaskActions defaults to read",
        actual: () => grantTaskActions("run-default"),
        expected: [
          { resource: "task", action: "read", scope: { runId: "run-default" } },
        ],
      },
      {
        title: "grantSummaryActions defaults to read",
        actual: () => grantSummaryActions("run-default"),
        expected: [
          { resource: "summary", action: "read", scope: { runId: "run-default" } },
        ],
      },
      {
        title: "grantSummaryCollectionActions defaults to list",
        actual: () => grantSummaryCollectionActions(),
        expected: [{ resource: "summary", action: "list" }],
      },
      {
        title: "grantMemoryActions defaults to read without scope",
        actual: () => grantMemoryActions(),
        expected: [{ resource: "memory", action: "read" }],
      },
      {
        title: "grantContextActions defaults to read",
        actual: () => grantContextActions("run-default"),
        expected: [
          { resource: "context", action: "read", scope: { runId: "run-default" } },
        ],
      },
      {
        title: "grantRuntimePathsActions defaults to read",
        actual: () => grantRuntimePathsActions(),
        expected: [{ resource: "runtime_paths", action: "read" }],
      },
    ];

    for (const testCase of cases) {
      expect(testCase.actual()).toEqual(testCase.expected);
    }
  });

  it("composes helper outputs without changing order or dropping scope", () => {
    const combined = [
      ...grantRunActions("run-compose", ["pause"]),
      ...grantApprovalActions(["manage"], {
        runId: "run-compose",
        approvalId: "approval-compose",
        tool: "release.deploy",
      }),
      ...grantArtifactActions("run-compose", ["read"], "artifact-compose"),
      ...grantMemoryActions(["read"], {
        runId: "run-compose",
        memoryId: "memory-compose",
      }),
      ...grantRuntimePathsActions(["read"]),
    ];

    expect(combined).toEqual([
      { resource: "run", action: "pause", scope: { runId: "run-compose" } },
      {
        resource: "approval",
        action: "manage",
        scope: {
          runId: "run-compose",
          approvalId: "approval-compose",
          tool: "release.deploy",
        },
      },
      {
        resource: "artifact",
        action: "read",
        scope: { runId: "run-compose", artifactId: "artifact-compose" },
      },
      {
        resource: "memory",
        action: "read",
        scope: { runId: "run-compose", memoryId: "memory-compose" },
      },
      { resource: "runtime_paths", action: "read" },
    ]);
  });
});
