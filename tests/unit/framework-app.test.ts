import { describe, expect, it } from "bun:test";

import {
  FrameworkContractError,
  defineAgentApp,
  defineAgentPolicy,
  defineCapability,
  defineMemorySpace,
  defineOperatorView,
  defineWorkflow,
  summarizeAgentApp,
} from "../../packages/ai/src/framework/index.ts";

function expectAppError(run: () => unknown, code: string, path?: string): void {
  try {
    run();
    throw new Error("expected framework app error");
  } catch (error) {
    expect(error).toBeInstanceOf(FrameworkContractError);
    expect((error as InstanceType<typeof FrameworkContractError>).code).toBe(code);
    if (path !== undefined) {
      expect((error as InstanceType<typeof FrameworkContractError>).path).toBe(path);
    }
  }
}

function buildValidApp() {
  const inspectMailbox = defineCapability({
    id: "inspect-mailbox",
    title: "Inspect mailbox",
    description: "Read mailbox state and summarize the next action.",
    tools: ["read_mailbox", "summarize_run"],
    defaultPolicies: ["require-review"],
    defaultMemorySpaces: ["run-notes"],
  });

  const resolveIssue = defineCapability({
    id: "resolve-issue",
    title: "Resolve issue",
    description: "Repair the active issue and produce a handoff.",
    tasks: ["repair-task"],
    defaultPolicies: ["require-review", "protect-secrets"],
    defaultMemorySpaces: ["run-notes", "project-memory"],
  });

  const triageLoop = defineWorkflow({
    id: "triage-loop",
    title: "Triage loop",
    description: "Inspect the next item and repair it if needed.",
    entryCapability: "inspect-mailbox",
    stages: [
      {
        id: "inspect",
        capability: "inspect-mailbox",
        description: "Inspect the active work item.",
        next: ["repair"],
      },
      {
        id: "repair",
        capability: "resolve-issue",
        description: "Repair the active work item.",
        terminal: true,
      },
    ],
    triggers: [{ type: "manual" }],
    defaultPolicies: ["require-review"],
    defaultMemorySpaces: ["run-notes"],
  });

  const requireReview = defineAgentPolicy({
    id: "require-review",
    title: "Require review",
    description: "Pause risky repairs until an operator reviews them.",
    rules: [
      {
        id: "review-repairs",
        appliesTo: [{ kind: "capability", ids: ["resolve-issue"] }],
        action: "require_approval",
        reason: "Repair work can mutate external state.",
        risk: "high",
      },
    ],
  });

  const protectSecrets = defineAgentPolicy({
    id: "protect-secrets",
    title: "Protect secrets",
    description: "Deny secret-bearing work unless explicitly isolated.",
    rules: [
      {
        id: "deny-project-memory",
        appliesTo: [{ kind: "memory_space", ids: ["project-memory"] }],
        action: "deny",
        reason: "Project memory may hold sensitive context.",
        risk: "critical",
      },
    ],
  });

  const runNotes = defineMemorySpace({
    id: "run-notes",
    title: "Run notes",
    description: "Short-lived working notes for the current run.",
    scope: "run",
    recordKinds: ["note", "decision"],
  });

  const projectMemory = defineMemorySpace({
    id: "project-memory",
    title: "Project memory",
    description: "Cross-run project facts.",
    scope: "project",
    recordKinds: ["fact", "constraint"],
    retention: { mode: "ttl", ttlDays: 30, maxItems: 50 },
  });

  const approvalInbox = defineOperatorView({
    id: "approval-inbox",
    title: "Approval inbox",
    description: "Review blocked actions and resume runs.",
    scope: "project",
    projection: "approval_inbox",
    filters: {
      capabilityIds: ["resolve-issue"],
      policyIds: ["require-review"],
      memorySpaceIds: ["run-notes"],
    },
    actions: ["approve", "deny", "resume"],
  });

  return defineAgentApp({
    id: "ops-agent",
    title: "Ops agent",
    description: "A graph-native supervised operations agent.",
    capabilities: [inspectMailbox, resolveIssue],
    workflows: [triageLoop],
    policies: [requireReview, protectSecrets],
    memorySpaces: [runNotes, projectMemory],
    operatorViews: [approvalInbox],
    defaults: {
      defaultWorkflow: "triage-loop",
      defaultPolicies: ["require-review"],
      defaultMemorySpaces: ["run-notes"],
    },
  });
}

describe("framework app composition", () => {
  it("builds a coherent app with indexes and defaults", () => {
    const app = buildValidApp();

    expect(app.kind).toBe("agent_app");
    expect(app.id).toBe("ops-agent");
    expect(app.title).toBe("Ops agent");
    expect(app.capabilities).toHaveLength(2);
    expect(app.workflows).toHaveLength(1);
    expect(app.policies).toHaveLength(2);
    expect(app.memorySpaces).toHaveLength(2);
    expect(app.operatorViews).toHaveLength(1);

    expect(app.indexes.capabilities["resolve-issue"]).toEqual(app.capabilities[1]);
    expect(app.indexes.workflows["triage-loop"]).toEqual(app.workflows[0]);
    expect(app.indexes.policies["require-review"]).toEqual(app.policies[0]);
    expect(app.indexes.memorySpaces["run-notes"]).toEqual(app.memorySpaces[0]);
    expect(app.indexes.operatorViews["approval-inbox"]).toEqual(app.operatorViews[0]);

    expect(app.defaults).toEqual({
      defaultWorkflow: "triage-loop",
      defaultPolicies: ["require-review"],
      defaultMemorySpaces: ["run-notes"],
    });

    expect(Object.isFrozen(app)).toBe(true);
    expect(Object.isFrozen(app.indexes)).toBe(true);
    expect(Object.isFrozen(app.capabilities)).toBe(true);
  });

  it("summarizes an app into a stable developer-facing read model", () => {
    const app = buildValidApp();
    const summary = summarizeAgentApp(app);

    expect(summary).toEqual({
      id: "ops-agent",
      title: "Ops agent",
      description: "A graph-native supervised operations agent.",
      defaults: {
        defaultWorkflow: "triage-loop",
        defaultPolicies: ["require-review"],
        defaultMemorySpaces: ["run-notes"],
      },
      capabilities: [
        {
          id: "inspect-mailbox",
          title: "Inspect mailbox",
          description: "Read mailbox state and summarize the next action.",
        },
        {
          id: "resolve-issue",
          title: "Resolve issue",
          description: "Repair the active issue and produce a handoff.",
        },
      ],
      workflows: [
        {
          id: "triage-loop",
          title: "Triage loop",
          description: "Inspect the next item and repair it if needed.",
          entryCapability: "inspect-mailbox",
        },
      ],
      policies: [
        {
          id: "require-review",
          title: "Require review",
          description: "Pause risky repairs until an operator reviews them.",
        },
        {
          id: "protect-secrets",
          title: "Protect secrets",
          description: "Deny secret-bearing work unless explicitly isolated.",
        },
      ],
      memorySpaces: [
        {
          id: "run-notes",
          title: "Run notes",
          description: "Short-lived working notes for the current run.",
          scope: "run",
        },
        {
          id: "project-memory",
          title: "Project memory",
          description: "Cross-run project facts.",
          scope: "project",
        },
      ],
      operatorViews: [
        {
          id: "approval-inbox",
          title: "Approval inbox",
          description: "Review blocked actions and resume runs.",
          scope: "project",
          projection: "approval_inbox",
        },
      ],
    });

    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.capabilities)).toBe(true);
  });

  it("deduplicates identical subcontracts inside an app while allowing ids to overlap across contract kinds", () => {
    const app = defineAgentApp({
      id: "dedupe-agent",
      description: "Duplicate normalized contracts.",
      capabilities: [
        defineCapability({ id: "inspect", description: "Inspect state." }),
        defineCapability({ id: " inspect ", description: " Inspect state. " }),
      ],
      workflows: [
        defineWorkflow({
          id: "inspect",
          description: "Workflow that shares an id with the capability.",
          entryCapability: "inspect",
          stages: [{ id: "inspect", capability: "inspect", description: "Inspect.", terminal: true }],
        }),
        defineWorkflow({
          id: " inspect ",
          description: " Workflow that shares an id with the capability. ",
          entryCapability: "inspect",
          stages: [{ id: "inspect", capability: "inspect", description: "Inspect.", terminal: true }],
        }),
      ],
      policies: [
        defineAgentPolicy({
          id: "shared",
          description: "Shared policy id.",
          rules: [
            {
              id: "shared",
              appliesTo: [{ kind: "capability", ids: ["inspect"] }],
              action: "allow",
              reason: "safe",
            },
          ],
        }),
      ],
      memorySpaces: [
        defineMemorySpace({
          id: "shared",
          description: "Shared memory id.",
          scope: "run",
        }),
      ],
      operatorViews: [
        defineOperatorView({
          id: "shared",
          description: "Shared view id.",
          scope: "project",
          projection: "task_board",
        }),
      ],
    });

    expect(app.capabilities).toHaveLength(1);
    expect(app.workflows).toHaveLength(1);
    expect(app.policies).toHaveLength(1);
    expect(app.memorySpaces).toHaveLength(1);
    expect(app.operatorViews).toHaveLength(1);
    expect(app.workflows[0]?.id).toBe("inspect");
    expect(app.policies[0]?.id).toBe("shared");
    expect(app.memorySpaces[0]?.id).toBe("shared");
    expect(app.operatorViews[0]?.id).toBe("shared");
  });

  it("rejects apps without capabilities", () => {
    expectAppError(
      () =>
        defineAgentApp({
          id: "empty-agent",
          description: "No capabilities.",
          capabilities: [],
        }),
      "missing_capabilities",
      "agent_app.capabilities",
    );
  });

  it("rejects conflicting contracts inside the same app collection", () => {
    expectAppError(
      () =>
        defineAgentApp({
          id: "conflict-agent",
          description: "Conflict.",
          capabilities: [
            defineCapability({ id: "inspect", description: "Inspect." }),
            defineCapability({ id: "inspect", description: "Inspect something else." }),
          ],
        }),
      "conflicting_contract",
      "capability.inspect",
    );
  });

  it("rejects capabilities that reference missing policies or memory spaces", () => {
    expectAppError(
      () =>
        defineAgentApp({
          id: "missing-capability-refs",
          description: "Missing refs.",
          capabilities: [
            defineCapability({
              id: "inspect",
              description: "Inspect.",
              defaultPolicies: ["require-review"],
              defaultMemorySpaces: ["run-notes"],
            }),
          ],
        }),
      "missing_reference",
      "capability.inspect.defaultPolicies",
    );

    expectAppError(
      () =>
        defineAgentApp({
          id: "missing-memory-ref",
          description: "Missing refs.",
          capabilities: [
            defineCapability({
              id: "inspect",
              description: "Inspect.",
              defaultMemorySpaces: ["run-notes"],
            }),
          ],
          policies: [
            defineAgentPolicy({
              id: "allow",
              description: "Allow.",
              rules: [
                {
                  id: "allow-inspect",
                  appliesTo: [{ kind: "capability", ids: ["inspect"] }],
                  action: "allow",
                  reason: "safe",
                },
              ],
            }),
          ],
        }),
      "missing_reference",
      "capability.inspect.defaultMemorySpaces",
    );
  });

  it("rejects workflows that reference missing capabilities", () => {
    expectAppError(
      () =>
        defineAgentApp({
          id: "missing-entry",
          description: "Missing entry capability.",
          capabilities: [defineCapability({ id: "inspect", description: "Inspect." })],
          workflows: [
            defineWorkflow({
              id: "flow",
              description: "Flow.",
              entryCapability: "missing-entry",
              stages: [{ id: "inspect", capability: "inspect", description: "Inspect.", terminal: true }],
            }),
          ],
        }),
      "missing_reference",
      "workflow.flow.entryCapability",
    );

    expectAppError(
      () =>
        defineAgentApp({
          id: "missing-stage-capability",
          description: "Missing stage capability.",
          capabilities: [defineCapability({ id: "inspect", description: "Inspect." })],
          workflows: [
            defineWorkflow({
              id: "flow",
              description: "Flow.",
              entryCapability: "inspect",
              stages: [{ id: "repair", capability: "repair", description: "Repair.", terminal: true }],
            }),
          ],
        }),
      "missing_reference",
      "workflow.flow.stages.repair.capability",
    );
  });

  it("rejects policies that point at missing local contracts but allows external tool/task targets", () => {
    expectAppError(
      () =>
        defineAgentApp({
          id: "missing-policy-target",
          description: "Missing policy target.",
          capabilities: [defineCapability({ id: "inspect", description: "Inspect." })],
          policies: [
            defineAgentPolicy({
              id: "guard",
              description: "Guard.",
              rules: [
                {
                  id: "guard-workflow",
                  appliesTo: [{ kind: "workflow", ids: ["missing-workflow"] }],
                  action: "deny",
                  reason: "bad",
                },
              ],
            }),
          ],
        }),
      "missing_reference",
      "policy.guard.rules.guard-workflow.appliesTo",
    );

    const app = defineAgentApp({
      id: "external-targets",
      description: "External targets are allowed.",
      capabilities: [defineCapability({ id: "inspect", description: "Inspect." })],
      policies: [
        defineAgentPolicy({
          id: "guard",
          description: "Guard.",
          rules: [
            {
              id: "guard-task",
              appliesTo: [
                { kind: "tool", ids: ["browser.click"] },
                { kind: "task", ids: ["repair-task"] },
              ],
              action: "require_approval",
              reason: "external work needs review",
            },
          ],
        }),
      ],
    });

    expect(app.policies[0]?.rules[0]?.appliesTo).toEqual([
      { kind: "tool", ids: ["browser.click"] },
      { kind: "task", ids: ["repair-task"] },
    ]);
  });

  it("rejects operator views that filter on missing contracts", () => {
    expectAppError(
      () =>
        defineAgentApp({
          id: "missing-view-filter",
          description: "Missing filter refs.",
          capabilities: [defineCapability({ id: "inspect", description: "Inspect." })],
          operatorViews: [
            defineOperatorView({
              id: "ops",
              description: "Ops.",
              scope: "project",
              projection: "task_board",
              filters: {
                capabilityIds: ["inspect"],
                workflowIds: ["missing-flow"],
              },
            }),
          ],
        }),
      "missing_reference",
      "operator_view.ops.filters.workflowIds",
    );
  });

  it("rejects invalid app defaults", () => {
    expectAppError(
      () =>
        defineAgentApp({
          id: "bad-defaults",
          description: "Bad defaults.",
          capabilities: [defineCapability({ id: "inspect", description: "Inspect." })],
          defaults: {
            defaultWorkflow: "missing-flow",
            defaultPolicies: ["missing-policy"],
            defaultMemorySpaces: ["missing-memory"],
          },
        }),
      "missing_reference",
      "agent_app.defaults.defaultWorkflow",
    );
  });
});
