import { describe, expect, it } from "bun:test";

import {
  FrameworkContractError,
  capabilitySignature,
  dedupeCapabilities,
  dedupeMemorySpaces,
  dedupeOperatorViews,
  dedupePolicies,
  dedupeWorkflows,
  defineAgentPolicy,
  defineCapability,
  defineMemorySpace,
  defineOperatorView,
  defineWorkflow,
  memorySpaceSignature,
  operatorViewSignature,
  policySignature,
  workflowSignature,
} from "../../packages/ai/src/framework/index.ts";

function expectContractError(run: () => unknown, code: string, path?: string): void {
  try {
    run();
    throw new Error("expected framework validation error");
  } catch (error) {
    expect(error).toBeInstanceOf(FrameworkContractError);
    expect((error as InstanceType<typeof FrameworkContractError>).code).toBe(code);
    if (path !== undefined) {
      expect((error as InstanceType<typeof FrameworkContractError>).path).toBe(path);
    }
  }
}

describe("framework capability contracts", () => {
  it("normalizes capability contracts deterministically and freezes nested data", () => {
    const capability = defineCapability({
      id: " Inspect Mailbox ",
      description: " Read the mailbox and current runtime graph. ",
      tags: ["ops", " ops ", "runtime"],
      metadata: {
        zebra: true,
        alpha: "first",
      },
      input: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 10 },
          includeClosed: { type: "boolean", default: false },
        },
      },
      output: {
        type: "object",
        properties: {
          blocked: { type: "boolean" },
        },
      },
      tools: [" read_mailbox ", "read_mailbox", "summarize_run"],
      tasks: [" review-task ", "review-task"],
      defaultPolicies: [" require-review ", "protect-secrets", "require-review"],
      defaultMemorySpaces: [" run-notes ", "project-memory", "run-notes"],
      artifactKinds: [" summary ", "summary", "trace"],
      operatorSignals: [" approval_requested ", "blocked", "blocked"],
      verification: {
        mode: "human",
        description: " Request explicit review for ambiguous mailbox state. ",
        requiredArtifacts: [" summary ", "trace", "summary"],
      },
    });

    expect(capability).toEqual({
      kind: "capability",
      id: "inspect-mailbox",
      title: "Inspect Mailbox",
      description: "Read the mailbox and current runtime graph.",
      tags: ["ops", "runtime"],
      metadata: { alpha: "first", zebra: true },
      input: {
        properties: {
          includeClosed: { default: false, type: "boolean" },
          limit: { default: 10, type: "integer" },
        },
        type: "object",
      },
      output: {
        properties: {
          blocked: { type: "boolean" },
        },
        type: "object",
      },
      tools: ["read-mailbox", "summarize-run"],
      tasks: ["review-task"],
      defaultPolicies: ["require-review", "protect-secrets"],
      defaultMemorySpaces: ["run-notes", "project-memory"],
      artifactKinds: ["summary", "trace"],
      operatorSignals: ["approval-requested", "blocked"],
      verification: {
        mode: "human",
        description: "Request explicit review for ambiguous mailbox state.",
        requiredArtifacts: ["summary", "trace"],
      },
    });
    expect(Object.isFrozen(capability)).toBe(true);
    expect(Object.isFrozen(capability.tags)).toBe(true);
    expect(Object.isFrozen(capability.tools)).toBe(true);
    expect(Object.isFrozen(capability.metadata!)).toBe(true);
    expect(Object.isFrozen(capability.verification!)).toBe(true);
  });

  it("rejects malformed capability definitions with stable paths", () => {
    expectContractError(
      () =>
        defineCapability({
          id: "   ",
          description: "x",
        }),
      "invalid_text",
      "capability.id",
    );

    expectContractError(
      () =>
        defineCapability({
          id: "inspect",
          description: "   ",
        }),
      "invalid_text",
      "capability.description",
    );

    expectContractError(
      () =>
        defineCapability({
          id: "inspect",
          description: "Inspect state.",
          input: [] as never,
        }),
      "invalid_type",
      "capability.input",
    );

    expectContractError(
      () =>
        defineCapability({
          id: "inspect",
          description: "Inspect state.",
          verification: { mode: "agent" as never },
        }),
      "invalid_verification_mode",
      "capability.verification.mode",
    );

    expectContractError(
      () =>
        defineCapability({
          id: "inspect",
          description: "Inspect state.",
          tools: "read_mailbox" as never,
        }),
      "invalid_type",
      "capability.tools",
    );
  });

  it("deduplicates equivalent capabilities and rejects conflicting contracts", () => {
    const deduped = dedupeCapabilities([
      {
        id: "Inspect Mailbox",
        description: "Read the mailbox.",
      },
      {
        id: " inspect-mailbox ",
        description: " Read the mailbox. ",
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(capabilitySignature(deduped[0]!)).toBe(capabilitySignature({
      id: "inspect-mailbox",
      description: "Read the mailbox.",
    }));

    expectContractError(
      () =>
        dedupeCapabilities([
          {
            id: "inspect-mailbox",
            description: "Read the mailbox.",
          },
          {
            id: "inspect-mailbox",
            description: "Read a different mailbox.",
          },
        ]),
      "conflicting_contract",
      "capability.inspect-mailbox",
    );
  });
});

describe("framework workflow contracts", () => {
  it("normalizes workflow stages, triggers, retry, and completion contracts", () => {
    const workflow = defineWorkflow({
      id: " Repair Loop ",
      description: " Investigate, repair, and hand off the active incident. ",
      entryCapability: "inspect-mailbox",
      stages: [
        {
          id: "inspect",
          capability: "inspect-mailbox",
          description: "Inspect the active state.",
          next: ["repair", "repair"],
        },
        {
          id: "repair",
          capability: "resolve-issue",
          description: "Repair the active incident.",
          terminal: true,
        },
      ],
      triggers: [
        { type: "manual" },
        { type: "cron", schedule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" },
        { type: "event", event: "incident.opened" },
        { type: "webhook", source: "pagerduty" },
        { type: "queue", queue: "repairs" },
      ],
      retry: { maxAttempts: 4, backoffMs: 250 },
      completion: { mode: "signal", signal: "repair-complete" },
      concurrency: "replace",
      defaultPolicies: ["require-review", "protect-secrets"],
      defaultMemorySpaces: ["run-notes", "project-memory"],
    });

    expect(workflow).toEqual({
      kind: "workflow",
      id: "repair-loop",
      title: "Repair Loop",
      description: "Investigate, repair, and hand off the active incident.",
      tags: [],
      entryCapability: "inspect-mailbox",
      stages: [
        {
          id: "inspect",
          capability: "inspect-mailbox",
          description: "Inspect the active state.",
          next: ["repair"],
          terminal: false,
        },
        {
          id: "repair",
          capability: "resolve-issue",
          description: "Repair the active incident.",
          next: [],
          terminal: true,
        },
      ],
      triggers: [
        { type: "manual" },
        { type: "cron", schedule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" },
        { type: "event", event: "incident.opened" },
        { type: "webhook", source: "pagerduty" },
        { type: "queue", queue: "repairs" },
      ],
      retry: { maxAttempts: 4, backoffMs: 250 },
      completion: { mode: "signal", signal: "repair-complete" },
      concurrency: "replace",
      defaultPolicies: ["require-review", "protect-secrets"],
      defaultMemorySpaces: ["run-notes", "project-memory"],
    });
  });

  it("rejects malformed workflow definitions", () => {
    expectContractError(
      () =>
        defineWorkflow({
          id: "empty",
          description: "No stages.",
          entryCapability: "inspect",
          stages: [],
        }),
      "missing_stages",
      "workflow.stages",
    );

    expectContractError(
      () =>
        defineWorkflow({
          id: "bad-stage",
          description: "Terminal stage with next refs.",
          entryCapability: "inspect",
          stages: [
            {
              id: "inspect",
              capability: "inspect",
              description: "Inspect.",
              terminal: true,
              next: ["repair"],
            },
            {
              id: "repair",
              capability: "repair",
              description: "Repair.",
            },
          ],
        }),
      "invalid_stage_transition",
      "workflow.stages[0]",
    );

    expectContractError(
      () =>
        defineWorkflow({
          id: "missing-next",
          description: "Unknown next stage.",
          entryCapability: "inspect",
          stages: [
            {
              id: "inspect",
              capability: "inspect",
              description: "Inspect.",
              next: ["repair"],
            },
          ],
        }),
      "missing_stage_reference",
      "workflow.stages.inspect.next",
    );

    expectContractError(
      () =>
        defineWorkflow({
          id: "bad-cron",
          description: "Cron without schedule.",
          entryCapability: "inspect",
          stages: [
            {
              id: "inspect",
              capability: "inspect",
              description: "Inspect.",
              terminal: true,
            },
          ],
          triggers: [{ type: "cron" }],
        }),
      "invalid_type",
      "workflow.triggers[0].schedule",
    );

    expectContractError(
      () =>
        defineWorkflow({
          id: "bad-completion",
          description: "Signal completion without signal.",
          entryCapability: "inspect",
          stages: [
            {
              id: "inspect",
              capability: "inspect",
              description: "Inspect.",
              terminal: true,
            },
          ],
          completion: { mode: "signal" },
        }),
      "invalid_type",
      "workflow.completion.signal",
    );

    expectContractError(
      () =>
        defineWorkflow({
          id: "bad-concurrency",
          description: "Unsupported concurrency.",
          entryCapability: "inspect",
          stages: [
            {
              id: "inspect",
              capability: "inspect",
              description: "Inspect.",
              terminal: true,
            },
          ],
          concurrency: "serial" as never,
        }),
      "invalid_concurrency",
      "workflow.concurrency",
    );
  });

  it("deduplicates equivalent workflows and rejects conflicting ones", () => {
    const deduped = dedupeWorkflows([
      {
        id: "triage-flow",
        description: "Triage.",
        entryCapability: "inspect",
        stages: [{ id: "inspect", capability: "inspect", description: "Inspect.", terminal: true }],
      },
      {
        id: " triage-flow ",
        description: " Triage. ",
        entryCapability: "inspect",
        stages: [{ id: "inspect", capability: "inspect", description: "Inspect.", terminal: true }],
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(workflowSignature(deduped[0]!)).toBe(workflowSignature({
      id: "triage-flow",
      description: "Triage.",
      entryCapability: "inspect",
      stages: [{ id: "inspect", capability: "inspect", description: "Inspect.", terminal: true }],
    }));

    expectContractError(
      () =>
        dedupeWorkflows([
          {
            id: "triage-flow",
            description: "Triage.",
            entryCapability: "inspect",
            stages: [{ id: "inspect", capability: "inspect", description: "Inspect.", terminal: true }],
          },
          {
            id: "triage-flow",
            description: "Different triage.",
            entryCapability: "inspect",
            stages: [{ id: "inspect", capability: "inspect", description: "Inspect.", terminal: true }],
          },
        ]),
      "conflicting_contract",
      "workflow.triage-flow",
    );
  });
});

describe("framework policy contracts", () => {
  it("normalizes policy rules and applies a safe fallback by default", () => {
    const policy = defineAgentPolicy({
      id: " Require Review ",
      description: " Require operator review for risky repairs. ",
      rules: [
        {
          id: "repair-review",
          appliesTo: [
            { kind: "capability", ids: ["resolve-issue", " resolve-issue "] },
            { kind: "memory_space", ids: ["project-memory"] },
            { kind: "tool", ids: ["browser.click"] },
          ],
          action: "require_approval",
          reason: "Repair work can touch external state.",
          risk: "high",
          metadata: { phase: "repair" },
        },
      ],
    });

    expect(policy).toEqual({
      kind: "policy",
      id: "require-review",
      title: "Require Review",
      description: "Require operator review for risky repairs.",
      tags: [],
      rules: [
        {
          id: "repair-review",
          appliesTo: [
            { kind: "capability", ids: ["resolve-issue"] },
            { kind: "memory_space", ids: ["project-memory"] },
            { kind: "tool", ids: ["browser.click"] },
          ],
          action: "require_approval",
          reason: "Repair work can touch external state.",
          risk: "high",
          metadata: { phase: "repair" },
        },
      ],
      fallback: {
        action: "deny",
        reason: "Deny by default when no policy rule matches.",
        risk: "medium",
      },
    });
  });

  it("rejects malformed policies", () => {
    expectContractError(
      () =>
        defineAgentPolicy({
          id: "broken",
          description: "Broken.",
          rules: [],
        }),
      "missing_policy_rules",
      "policy.rules",
    );

    expectContractError(
      () =>
        defineAgentPolicy({
          id: "broken",
          description: "Broken.",
          rules: [
            {
              id: "x",
              appliesTo: [{ kind: "policy" as never, ids: ["bad"] }],
              action: "deny",
              reason: "bad",
            },
          ],
        }),
      "invalid_target_kind",
      "policy.rules[0].appliesTo[0].kind",
    );

    expectContractError(
      () =>
        defineAgentPolicy({
          id: "broken",
          description: "Broken.",
          rules: [
            {
              id: "x",
              appliesTo: [{ kind: "capability", ids: [] }],
              action: "deny",
              reason: "bad",
            },
          ],
        }),
      "missing_target_ids",
      "policy.rules[0].appliesTo[0].ids",
    );

    expectContractError(
      () =>
        defineAgentPolicy({
          id: "broken",
          description: "Broken.",
          rules: [
            {
              id: "x",
              appliesTo: [{ kind: "capability", ids: ["inspect"] }],
              action: "approve" as never,
              reason: "bad",
            },
          ],
        }),
      "invalid_policy_action",
      "policy.rules[0].action",
    );
  });

  it("deduplicates equivalent policies and rejects conflicting ones", () => {
    const deduped = dedupePolicies([
      {
        id: "require-review",
        description: "Review.",
        rules: [
          {
            id: "review",
            appliesTo: [{ kind: "capability", ids: ["inspect"] }],
            action: "require_approval",
            reason: "review",
          },
        ],
      },
      {
        id: " require-review ",
        description: " Review. ",
        rules: [
          {
            id: "review",
            appliesTo: [{ kind: "capability", ids: ["inspect"] }],
            action: "require_approval",
            reason: "review",
          },
        ],
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(policySignature(deduped[0]!)).toBe(policySignature({
      id: "require-review",
      description: "Review.",
      rules: [
        {
          id: "review",
          appliesTo: [{ kind: "capability", ids: ["inspect"] }],
          action: "require_approval",
          reason: "review",
        },
      ],
    }));

    expectContractError(
      () =>
        dedupePolicies([
          {
            id: "require-review",
            description: "Review.",
            rules: [
              {
                id: "review",
                appliesTo: [{ kind: "capability", ids: ["inspect"] }],
                action: "require_approval",
                reason: "review",
              },
            ],
          },
          {
            id: "require-review",
            description: "Review.",
            rules: [
              {
                id: "review",
                appliesTo: [{ kind: "capability", ids: ["inspect"] }],
                action: "deny",
                reason: "review",
              },
            ],
          },
        ]),
      "conflicting_contract",
      "policy.require-review",
    );
  });
});

describe("framework memory space contracts", () => {
  it("normalizes memory spaces with promotion, retention, retrieval, and graph binding", () => {
    const memorySpace = defineMemorySpace({
      id: " Project Memory ",
      description: " Stable project facts. ",
      scope: "project",
      recordKinds: ["fact", " constraint ", "fact"],
      promotion: { mode: "verified", minConfidence: 0.8 },
      retention: { mode: "ttl", ttlDays: 30, maxItems: 50 },
      retrieval: { strategy: "priority_first", maxItems: 8, minScore: 0.35 },
      graphBinding: { enabled: true, nodeKinds: ["memory", " approval ", "memory"] },
    });

    expect(memorySpace).toEqual({
      kind: "memory_space",
      id: "project-memory",
      title: "Project Memory",
      description: "Stable project facts.",
      tags: [],
      scope: "project",
      recordKinds: ["fact", "constraint"],
      promotion: { mode: "verified", minConfidence: 0.8 },
      retention: { mode: "ttl", ttlDays: 30, maxItems: 50 },
      retrieval: { strategy: "priority_first", maxItems: 8, minScore: 0.35 },
      graphBinding: { enabled: true, nodeKinds: ["memory", "approval"] },
    });
  });

  it("rejects malformed memory spaces", () => {
    expectContractError(
      () =>
        defineMemorySpace({
          id: "notes",
          description: "Notes.",
          scope: "workspace" as never,
        }),
      "invalid_memory_scope",
      "memory_space.scope",
    );

    expectContractError(
      () =>
        defineMemorySpace({
          id: "notes",
          description: "Notes.",
          scope: "project",
          retention: { mode: "ttl" },
        }),
      "missing_ttl",
      "memory_space.retention.ttlDays",
    );

    expectContractError(
      () =>
        defineMemorySpace({
          id: "notes",
          description: "Notes.",
          scope: "project",
          retrieval: { strategy: "vector" as never },
        }),
      "invalid_retrieval_strategy",
      "memory_space.retrieval.strategy",
    );

    expectContractError(
      () =>
        defineMemorySpace({
          id: "notes",
          description: "Notes.",
          scope: "project",
          promotion: { mode: "verified", minConfidence: 2 },
        }),
      "invalid_score",
      "memory_space.promotion.minConfidence",
    );
  });

  it("deduplicates equivalent memory spaces and rejects conflicting ones", () => {
    const deduped = dedupeMemorySpaces([
      {
        id: "run-notes",
        description: "Run notes.",
        scope: "run",
      },
      {
        id: " run-notes ",
        description: " Run notes. ",
        scope: "run",
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(memorySpaceSignature(deduped[0]!)).toBe(memorySpaceSignature({
      id: "run-notes",
      description: "Run notes.",
      scope: "run",
    }));

    expectContractError(
      () =>
        dedupeMemorySpaces([
          {
            id: "run-notes",
            description: "Run notes.",
            scope: "run",
          },
          {
            id: "run-notes",
            description: "Project notes.",
            scope: "project",
          },
        ]),
      "conflicting_contract",
      "memory_space.run-notes",
    );
  });
});

describe("framework operator view contracts", () => {
  it("normalizes built-in and custom operator views", () => {
    const builtIn = defineOperatorView({
      id: " Approval Inbox ",
      description: " Review blocked actions. ",
      scope: "project",
      projection: "approval_inbox",
      filters: {
        capabilityIds: ["resolve-issue", " resolve-issue "],
        policyIds: ["require-review"],
        memorySpaceIds: ["operator-history"],
        nodeKinds: ["approval", "run", "approval"],
        artifactKinds: ["summary", " summary "],
        text: " blocked only ",
      },
      actions: ["approve", "deny", "resume", "approve"],
    });

    const custom = defineOperatorView({
      id: "artifact-mosaic",
      description: "Visual artifact feed.",
      scope: "project",
      projection: "custom",
      customProjection: "artifact-mosaic",
    });

    expect(builtIn).toEqual({
      kind: "operator_view",
      id: "approval-inbox",
      title: "Approval Inbox",
      description: "Review blocked actions.",
      tags: [],
      scope: "project",
      projection: "approval_inbox",
      filters: {
        capabilityIds: ["resolve-issue"],
        workflowIds: [],
        policyIds: ["require-review"],
        memorySpaceIds: ["operator-history"],
        nodeKinds: ["approval", "run"],
        artifactKinds: ["summary"],
        text: "blocked only",
      },
      actions: ["approve", "deny", "resume"],
    });

    expect(custom.customProjection).toBe("artifact-mosaic");
    expect(custom.filters.capabilityIds).toEqual([]);
  });

  it("rejects malformed operator views", () => {
    expectContractError(
      () =>
        defineOperatorView({
          id: "ops",
          description: "Ops.",
          scope: "workspace" as never,
        }),
      "invalid_view_scope",
      "operator_view.scope",
    );

    expectContractError(
      () =>
        defineOperatorView({
          id: "ops",
          description: "Ops.",
          scope: "project",
          projection: "custom",
        }),
      "invalid_type",
      "operator_view.customProjection",
    );

    expectContractError(
      () =>
        defineOperatorView({
          id: "ops",
          description: "Ops.",
          scope: "project",
          filters: "bad" as never,
        }),
      "invalid_type",
      "operator_view.filters",
    );
  });

  it("deduplicates equivalent operator views and rejects conflicting ones", () => {
    const deduped = dedupeOperatorViews([
      {
        id: "task-board",
        description: "Tasks.",
        scope: "project",
        projection: "task_board",
      },
      {
        id: " task-board ",
        description: " Tasks. ",
        scope: "project",
        projection: "task_board",
      },
    ]);

    expect(deduped).toHaveLength(1);
    expect(operatorViewSignature(deduped[0]!)).toBe(operatorViewSignature({
      id: "task-board",
      description: "Tasks.",
      scope: "project",
      projection: "task_board",
    }));

    expectContractError(
      () =>
        dedupeOperatorViews([
          {
            id: "task-board",
            description: "Tasks.",
            scope: "project",
            projection: "task_board",
          },
          {
            id: "task-board",
            description: "Tasks.",
            scope: "run",
            projection: "run_timeline",
          },
        ]),
      "conflicting_contract",
      "operator_view.task-board",
    );
  });
});
