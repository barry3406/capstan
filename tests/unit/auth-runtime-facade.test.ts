import { describe, it, expect } from "bun:test";
import {
  createDelegationLink,
  createExecutionIdentity,
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
  grantSummaryActions,
  grantSummaryCollectionActions,
  grantTaskActions,
  grantRuntimePathsActions,
  authorizeGrant,
} from "@zauso-ai/capstan-auth";

describe("auth runtime facade", () => {
  it("issues run-scoped grants for runtime supervision", () => {
    const grants = grantRunActions("run-1");

    expect(grants).toHaveLength(4);
    expect(grants.map((grant) => grant.action)).toEqual([
      "read",
      "pause",
      "cancel",
      "resume",
    ]);
    for (const grant of grants) {
      expect(grant.resource).toBe("run");
      expect(grant.scope).toEqual({ runId: "run-1" });
    }
  });

  it("issues approval grants scoped to a specific approval and run", () => {
    const grants = grantApprovalActions(["read", "approve"], {
      approvalId: "approval-7",
      runId: "run-1",
    });

    expect(grants).toHaveLength(2);
    expect(grants[0]).toMatchObject({
      resource: "approval",
      action: "read",
      scope: { approvalId: "approval-7", runId: "run-1" },
    });
    expect(grants[1]).toMatchObject({
      resource: "approval",
      action: "approve",
      scope: { approvalId: "approval-7", runId: "run-1" },
    });
  });

  it("issues artifact and checkpoint grants with run scope", () => {
    const artifactGrants = grantArtifactActions("run-1", ["read"], "artifact-9");
    const checkpointGrants = grantCheckpointActions("run-1");

    expect(artifactGrants[0]).toMatchObject({
      resource: "artifact",
      action: "read",
      scope: { runId: "run-1", artifactId: "artifact-9" },
    });
    expect(checkpointGrants[0]).toMatchObject({
      resource: "checkpoint",
      action: "read",
      scope: { runId: "run-1" },
    });
  });

  it("issues collection and control-plane grants for harness resources", () => {
    const runCollection = grantRunCollectionActions();
    const approvalCollection = grantApprovalCollectionActions(["list"], {
      runId: "run-1",
    });
    const eventCollection = grantEventCollectionActions();
    const eventGrants = grantEventActions("run-1");
    const taskGrants = grantTaskActions("run-1", ["read"], "task-4");
    const summaryCollection = grantSummaryCollectionActions();
    const summaryGrants = grantSummaryActions("run-1", ["read"], "summary-2");
    const memoryGrants = grantMemoryActions(["read"], { runId: "run-1", memoryId: "mem-8" });
    const contextGrants = grantContextActions("run-1");
    const runtimePathsGrants = grantRuntimePathsActions();

    expect(runCollection).toEqual([
      { resource: "run", action: "start" },
      { resource: "run", action: "list" },
    ]);
    expect(approvalCollection).toEqual([
      { resource: "approval", action: "list", scope: { runId: "run-1" } },
    ]);
    expect(eventCollection).toEqual([{ resource: "event", action: "list" }]);
    expect(eventGrants[0]).toMatchObject({
      resource: "event",
      action: "read",
      scope: { runId: "run-1" },
    });
    expect(taskGrants[0]).toMatchObject({
      resource: "task",
      action: "read",
      scope: { runId: "run-1", taskId: "task-4" },
    });
    expect(summaryGrants[0]).toMatchObject({
      resource: "summary",
      action: "read",
      scope: { runId: "run-1", summaryId: "summary-2" },
    });
    expect(summaryCollection).toEqual([{ resource: "summary", action: "list" }]);
    expect(memoryGrants[0]).toMatchObject({
      resource: "memory",
      action: "read",
      scope: { runId: "run-1", memoryId: "mem-8" },
    });
    expect(contextGrants[0]).toMatchObject({
      resource: "context",
      action: "read",
      scope: { runId: "run-1" },
    });
    expect(runtimePathsGrants).toEqual([{ resource: "runtime_paths", action: "read" }]);
  });

  it("keeps runtime_paths and approval collection grants isolated from run-scoped read grants", () => {
    expect(
      authorizeGrant(
        { resource: "runtime_paths", action: "read" },
        grantRuntimePathsActions(),
      ).allowed,
    ).toBe(true);
    expect(
      authorizeGrant(
        { resource: "runtime_paths", action: "write" },
        grantRuntimePathsActions(),
      ).allowed,
    ).toBe(false);
    expect(
      authorizeGrant(
        { resource: "approval", action: "list", scope: { runId: "run-1" } },
        grantApprovalCollectionActions(["list"], { runId: "run-1" }),
      ).allowed,
    ).toBe(true);
    expect(
      authorizeGrant(
        { resource: "approval", action: "list", scope: { runId: "run-2" } },
        grantApprovalCollectionActions(["list"], { runId: "run-1" }),
      ).allowed,
    ).toBe(false);
  });

  it("authorizes only the matching runtime object", () => {
    const runGrants = grantRunActions("run-1");
    const approvalGrants = grantApprovalActions(["approve"], {
      approvalId: "approval-7",
      runId: "run-1",
    });

    expect(
      authorizeGrant(
        { resource: "run", action: "resume", scope: { runId: "run-1" } },
        runGrants,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeGrant(
        { resource: "run", action: "resume", scope: { runId: "run-2" } },
        runGrants,
      ).allowed,
    ).toBe(false);
    expect(
      authorizeGrant(
        { resource: "approval", action: "approve", scope: { approvalId: "approval-7" } },
        approvalGrants,
      ).allowed,
    ).toBe(true);
    expect(
      authorizeGrant(
        { resource: "approval", action: "approve", scope: { approvalId: "approval-8" } },
        approvalGrants,
      ).allowed,
    ).toBe(false);
    expect(
      authorizeGrant(
        { resource: "context", action: "read", scope: { runId: "run-1" } },
        grantContextActions("run-1"),
      ).allowed,
    ).toBe(true);
    expect(
      authorizeGrant(
        { resource: "memory", action: "read", scope: { runId: "run-2" } },
        grantMemoryActions(["read"], { runId: "run-1" }),
      ).allowed,
    ).toBe(false);
  });

  it("models delegation chains for runtime provenance", () => {
    const user = { kind: "user", id: "user-1", displayName: "Ada" } as const;
    const run = createExecutionIdentity("run", "run-1", {
      parentId: "request:POST /runs",
      metadata: { runId: "run-1" },
    });
    const toolCall = createExecutionIdentity("tool_call", "tool-1", {
      parentId: run.id,
      metadata: { tool: "ticket.create" },
    });

    const delegation = createDelegationLink(user, run, "operator started the run", {
      source: "supervision-console",
    });
    const runToTool = createDelegationLink(run, toolCall, "agent executed a tool call");

    expect(run.kind).toBe("run");
    expect(run.parentId).toBe("request:POST /runs");
    expect(toolCall.kind).toBe("tool_call");
    expect(toolCall.parentId).toBe(run.id);
    expect(delegation.from).toEqual({ kind: "user", id: "user-1" });
    expect(delegation.to).toEqual({ kind: "run", id: "run:run-1" });
    expect(runToTool.from).toEqual({ kind: "run", id: "run:run-1" });
    expect(runToTool.to).toEqual({ kind: "tool_call", id: "tool_call:tool-1" });
  });

  it("supports deny grants for runtime kill-switches", () => {
    const grants = [
      createGrant("run", "cancel", {
        scope: { runId: "run-1" },
        effect: "deny",
      }),
    ];

    expect(
      authorizeGrant(
        { resource: "run", action: "cancel", scope: { runId: "run-1" } },
        grants,
      ).allowed,
    ).toBe(false);
  });
});
