import { describe, expect, it } from "bun:test";

import {
  authorizeRuntimeAction,
  createGrant,
  deriveRuntimeGrantRequirements,
} from "@zauso-ai/capstan-auth";

type RequirementShape = {
  resource: string;
  action: string;
  scope?: Record<string, string>;
};

function summarizeRequirements(
  action: string,
  scope?: Record<string, string>,
  attributes?: Record<string, string>,
): RequirementShape[] {
  return deriveRuntimeGrantRequirements({
    action,
    ...(scope ? { scope } : {}),
    ...(attributes ? { attributes } : {}),
  }).map((requirement) => ({
    resource: requirement.resource,
    action: requirement.action,
    ...(requirement.scope ? { scope: requirement.scope } : {}),
  }));
}

describe("auth runtime authorizer matrix", () => {
  it("derives the expected fallback requirements for every read surface", () => {
    const cases: Array<{
      action: string;
      scope?: Record<string, string>;
      attributes?: Record<string, string>;
      expected: RequirementShape[];
    }> = [
      {
        action: "checkpoint:read",
        scope: { runId: "run-1", artifactId: "artifact-1" },
        expected: [
          { resource: "checkpoint", action: "read", scope: { runId: "run-1", artifactId: "artifact-1" } },
          { resource: "run", action: "read", scope: { runId: "run-1" } },
        ],
      },
      {
        action: "artifact:read",
        scope: { runId: "run-1", artifactId: "artifact-1" },
        expected: [
          { resource: "artifact", action: "read", scope: { runId: "run-1", artifactId: "artifact-1" } },
          { resource: "run", action: "read", scope: { runId: "run-1" } },
        ],
      },
      {
        action: "event:read",
        scope: { runId: "run-2" },
        expected: [
          { resource: "event", action: "read", scope: { runId: "run-2" } },
          { resource: "run", action: "read", scope: { runId: "run-2" } },
        ],
      },
      {
        action: "task:read",
        scope: { runId: "run-3", taskId: "task-1" },
        expected: [
          { resource: "task", action: "read", scope: { runId: "run-3", taskId: "task-1" } },
          { resource: "run", action: "read", scope: { runId: "run-3" } },
        ],
      },
      {
        action: "context:read",
        scope: { runId: "run-4" },
        expected: [
          { resource: "context", action: "read", scope: { runId: "run-4" } },
          { resource: "run", action: "read", scope: { runId: "run-4" } },
        ],
      },
      {
        action: "summary:read",
        scope: { runId: "run-5", summaryId: "summary-1" },
        expected: [
          { resource: "summary", action: "read", scope: { runId: "run-5", summaryId: "summary-1" } },
          { resource: "context", action: "read", scope: { runId: "run-5" } },
          { resource: "run", action: "read", scope: { runId: "run-5" } },
        ],
      },
      {
        action: "memory:read",
        scope: { runId: "run-6", memoryId: "memory-1" },
        attributes: { memoryKind: "session" },
        expected: [
          { resource: "memory", action: "read", scope: { runId: "run-6", memoryId: "memory-1" } },
          { resource: "context", action: "read", scope: { runId: "run-6" } },
          { resource: "run", action: "read", scope: { runId: "run-6" } },
        ],
      },
      {
        action: "memory:read",
        scope: { runId: "run-7", memoryId: "memory-2" },
        attributes: { memoryKind: "persistent" },
        expected: [
          { resource: "memory", action: "read", scope: { runId: "run-7", memoryId: "memory-2" } },
        ],
      },
      {
        action: "approval:read",
        scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" },
        expected: [
          { resource: "approval", action: "read", scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" } },
          { resource: "approval", action: "manage", scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" } },
        ],
      },
      {
        action: "approval:approve",
        scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" },
        expected: [
          { resource: "approval", action: "approve", scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" } },
          { resource: "approval", action: "manage", scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" } },
        ],
      },
      {
        action: "approval:deny",
        scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" },
        expected: [
          { resource: "approval", action: "deny", scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" } },
          { resource: "approval", action: "manage", scope: { runId: "run-8", approvalId: "approval-1", tool: "ticket.delete" } },
        ],
      },
      {
        action: "approval:list",
        scope: { runId: "run-9" },
        expected: [
          { resource: "approval", action: "list", scope: { runId: "run-9" } },
        ],
      },
      {
        action: "run:list",
        expected: [
          { resource: "run", action: "list" },
        ],
      },
      {
        action: "runtime_paths:read",
        expected: [
          { resource: "runtime_paths", action: "read" },
        ],
      },
    ];

    for (const testCase of cases) {
      expect(
        summarizeRequirements(testCase.action, testCase.scope, testCase.attributes),
      ).toEqual(testCase.expected);
    }
  });

  it("authorizes direct grants, fallbacks, and deny precedence across the matrix", () => {
    const cases: Array<{
      title: string;
      action: string;
      scope?: Record<string, string>;
      attributes?: Record<string, string>;
      grants: Array<string | ReturnType<typeof createGrant>>;
      expectedAllowed: boolean;
      expectedRequirement: RequirementShape;
      expectedEffect?: "deny";
    }> = [
      {
        title: "checkpoint direct",
        action: "checkpoint:read",
        scope: { runId: "run-1" },
        grants: [createGrant("checkpoint", "read", { scope: { runId: "run-1" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "checkpoint", action: "read", scope: { runId: "run-1" } },
      },
      {
        title: "checkpoint fallback to run",
        action: "checkpoint:read",
        scope: { runId: "run-1" },
        grants: [createGrant("run", "read", { scope: { runId: "run-1" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "read", scope: { runId: "run-1" } },
      },
      {
        title: "artifact fallback to run",
        action: "artifact:read",
        scope: { runId: "run-2", artifactId: "artifact-2" },
        grants: [createGrant("run", "read", { scope: { runId: "run-2" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "read", scope: { runId: "run-2" } },
      },
      {
        title: "event fallback to run",
        action: "event:read",
        scope: { runId: "run-3" },
        grants: [createGrant("run", "read", { scope: { runId: "run-3" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "read", scope: { runId: "run-3" } },
      },
      {
        title: "task fallback to run",
        action: "task:read",
        scope: { runId: "run-4", taskId: "task-4" },
        grants: [createGrant("run", "read", { scope: { runId: "run-4" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "read", scope: { runId: "run-4" } },
      },
      {
        title: "context fallback to run",
        action: "context:read",
        scope: { runId: "run-5" },
        grants: [createGrant("run", "read", { scope: { runId: "run-5" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "read", scope: { runId: "run-5" } },
      },
      {
        title: "summary fallback to context",
        action: "summary:read",
        scope: { runId: "run-6", summaryId: "summary-1" },
        grants: [createGrant("context", "read", { scope: { runId: "run-6" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "context", action: "read", scope: { runId: "run-6" } },
      },
      {
        title: "summary fallback to run",
        action: "summary:read",
        scope: { runId: "run-7", summaryId: "summary-2" },
        grants: [createGrant("run", "read", { scope: { runId: "run-7" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "read", scope: { runId: "run-7" } },
      },
      {
        title: "session memory fallback to context",
        action: "memory:read",
        scope: { runId: "run-8", memoryId: "memory-1" },
        attributes: { memoryKind: "session" },
        grants: [createGrant("context", "read", { scope: { runId: "run-8" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "context", action: "read", scope: { runId: "run-8" } },
      },
      {
        title: "session memory fallback to run",
        action: "memory:read",
        scope: { runId: "run-9", memoryId: "memory-2" },
        attributes: { memoryKind: "session" },
        grants: [createGrant("run", "read", { scope: { runId: "run-9" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "run", action: "read", scope: { runId: "run-9" } },
      },
      {
        title: "persistent memory requires memory grant",
        action: "memory:read",
        scope: { runId: "run-10", memoryId: "memory-3" },
        attributes: { memoryKind: "persistent" },
        grants: [createGrant("run", "read", { scope: { runId: "run-10" } })],
        expectedAllowed: false,
        expectedRequirement: { resource: "memory", action: "read", scope: { runId: "run-10", memoryId: "memory-3" } },
      },
      {
        title: "approval read via manage",
        action: "approval:read",
        scope: { runId: "run-11", approvalId: "approval-11", tool: "ticket.delete" },
        grants: [createGrant("approval", "manage", { scope: { runId: "run-11", approvalId: "approval-11", tool: "ticket.delete" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "approval", action: "manage", scope: { runId: "run-11", approvalId: "approval-11", tool: "ticket.delete" } },
      },
      {
        title: "approval approve via manage",
        action: "approval:approve",
        scope: { runId: "run-12", approvalId: "approval-12", tool: "ticket.delete" },
        grants: [createGrant("approval", "manage", { scope: { runId: "run-12", approvalId: "approval-12", tool: "ticket.delete" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "approval", action: "manage", scope: { runId: "run-12", approvalId: "approval-12", tool: "ticket.delete" } },
      },
      {
        title: "approval deny via manage",
        action: "approval:deny",
        scope: { runId: "run-13", approvalId: "approval-13", tool: "ticket.delete" },
        grants: [createGrant("approval", "manage", { scope: { runId: "run-13", approvalId: "approval-13", tool: "ticket.delete" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "approval", action: "manage", scope: { runId: "run-13", approvalId: "approval-13", tool: "ticket.delete" } },
      },
      {
        title: "approval manage wrong tool denied",
        action: "approval:approve",
        scope: { runId: "run-14", approvalId: "approval-14", tool: "ticket.delete" },
        grants: [createGrant("approval", "manage", { scope: { runId: "run-14", approvalId: "approval-14", tool: "other-tool" } })],
        expectedAllowed: false,
        expectedRequirement: { resource: "approval", action: "approve", scope: { runId: "run-14", approvalId: "approval-14", tool: "ticket.delete" } },
      },
      {
        title: "approval list via collection grant",
        action: "approval:list",
        scope: { runId: "run-15" },
        grants: [createGrant("approval", "list", { scope: { runId: "run-15" } })],
        expectedAllowed: true,
        expectedRequirement: { resource: "approval", action: "list", scope: { runId: "run-15" } },
      },
      {
        title: "approval list not satisfied by read",
        action: "approval:list",
        scope: { runId: "run-15" },
        grants: [createGrant("approval", "read", { scope: { runId: "run-15", approvalId: "approval-15" } })],
        expectedAllowed: false,
        expectedRequirement: { resource: "approval", action: "list", scope: { runId: "run-15" } },
      },
      {
        title: "run list not satisfied by read",
        action: "run:list",
        grants: [createGrant("run", "read", { scope: { runId: "run-16" } })],
        expectedAllowed: false,
        expectedRequirement: { resource: "run", action: "list" },
      },
      {
        title: "runtime paths isolated",
        action: "runtime_paths:read",
        grants: [createGrant("run", "read", { scope: { runId: "run-17" } })],
        expectedAllowed: false,
        expectedRequirement: { resource: "runtime_paths", action: "read" },
      },
      {
        title: "runtime paths direct grant",
        action: "runtime_paths:read",
        grants: [createGrant("runtime_paths", "read")],
        expectedAllowed: true,
        expectedRequirement: { resource: "runtime_paths", action: "read" },
      },
      {
        title: "context deny beats later run allow",
        action: "summary:read",
        scope: { runId: "run-18", summaryId: "summary-18" },
        grants: [
          createGrant("context", "read", {
            scope: { runId: "run-18" },
            effect: "deny",
          }),
          createGrant("run", "read", { scope: { runId: "run-18" } }),
        ],
        expectedAllowed: false,
        expectedRequirement: { resource: "context", action: "read", scope: { runId: "run-18" } },
        expectedEffect: "deny",
      },
    ];

    for (const testCase of cases) {
      const decision = authorizeRuntimeAction(
        {
          action: testCase.action,
          ...(testCase.scope ? { scope: testCase.scope } : {}),
          ...(testCase.attributes ? { attributes: testCase.attributes } : {}),
        },
        testCase.grants,
      );
      expect(decision.allowed).toBe(testCase.expectedAllowed);
      expect(decision.matchedRequirement).toEqual(testCase.expectedRequirement);
      if (testCase.expectedEffect) {
        expect(decision.matchedGrant?.effect).toBe(testCase.expectedEffect);
      }
    }
  });

  it("normalizes blank scope fields before deriving fallback requirements", () => {
    const cases: Array<{
      title: string;
      action: string;
      scope?: Record<string, string>;
      attributes?: Record<string, string>;
      expected: RequirementShape[];
    }> = [
      {
        title: "checkpoint read drops blank artifact and task fields",
        action: "checkpoint:read",
        scope: {
          runId: "run-20",
          artifactId: " ",
          taskId: "",
          summaryId: "summary-20",
        },
        expected: [
          {
            resource: "checkpoint",
            action: "read",
            scope: { runId: "run-20", summaryId: "summary-20" },
          },
          { resource: "run", action: "read", scope: { runId: "run-20" } },
        ],
      },
      {
        title: "summary read keeps only the nonblank summary id",
        action: "summary:read",
        scope: {
          runId: "   ",
          summaryId: "summary-21",
        },
        expected: [
          { resource: "summary", action: "read", scope: { summaryId: "summary-21" } },
          { resource: "context", action: "read" },
          { resource: "run", action: "read" },
        ],
      },
      {
        title: "session memory with a blank run id does not add fallback scopes",
        action: "memory:read",
        scope: {
          runId: "",
          memoryId: "memory-20",
        },
        attributes: { memoryKind: "session" },
        expected: [
          { resource: "memory", action: "read", scope: { memoryId: "memory-20" } },
        ],
      },
      {
        title: "approval read drops blank approval metadata but keeps run scope",
        action: "approval:read",
        scope: {
          runId: "run-21",
          approvalId: " ",
          tool: "",
        },
        expected: [
          { resource: "approval", action: "read", scope: { runId: "run-21" } },
          { resource: "approval", action: "manage", scope: { runId: "run-21" } },
        ],
      },
      {
        title: "task read keeps only the task id that has content",
        action: "task:read",
        scope: {
          runId: "run-22",
          taskId: "task-22",
          summaryId: "   ",
        },
        expected: [
          { resource: "task", action: "read", scope: { runId: "run-22", taskId: "task-22" } },
          { resource: "run", action: "read", scope: { runId: "run-22" } },
        ],
      },
      {
        title: "runtime paths stays scope free",
        action: "runtime_paths:read",
        expected: [{ resource: "runtime_paths", action: "read" }],
      },
    ];

    for (const testCase of cases) {
      expect(
        summarizeRequirements(testCase.action, testCase.scope, testCase.attributes),
      ).toEqual(testCase.expected);
    }
  });

  it("distinguishes direct allow, later deny, and fallback deny in the authorization ladder", () => {
    const cases: Array<{
      title: string;
      action: string;
      scope?: Record<string, string>;
      attributes?: Record<string, string>;
      grants: Array<string | ReturnType<typeof createGrant>>;
      expectedAllowed: boolean;
      expectedRequirement: RequirementShape;
      expectedEffect?: "deny";
    }> = [
      {
        title: "summary read allows on the direct summary grant even if later grants deny",
        action: "summary:read",
        scope: { runId: "run-23", summaryId: "summary-23" },
        grants: [
          createGrant("summary", "read", { scope: { runId: "run-23", summaryId: "summary-23" } }),
          createGrant("context", "read", {
            scope: { runId: "run-23" },
            effect: "deny",
          }),
        ],
        expectedAllowed: true,
        expectedRequirement: {
          resource: "summary",
          action: "read",
          scope: { runId: "run-23", summaryId: "summary-23" },
        },
      },
      {
        title: "summary read denies immediately on the first matching deny",
        action: "summary:read",
        scope: { runId: "run-24", summaryId: "summary-24" },
        grants: [
          createGrant("summary", "read", {
            scope: { runId: "run-24", summaryId: "summary-24" },
            effect: "deny",
          }),
          createGrant("context", "read", { scope: { runId: "run-24" } }),
          createGrant("run", "read", { scope: { runId: "run-24" } }),
        ],
        expectedAllowed: false,
        expectedRequirement: {
          resource: "summary",
          action: "read",
          scope: { runId: "run-24", summaryId: "summary-24" },
        },
        expectedEffect: "deny",
      },
      {
        title: "approval approve allows on manage fallback before a later deny",
        action: "approval:approve",
        scope: {
          runId: "run-25",
          approvalId: "approval-25",
          tool: "ticket.delete",
        },
        grants: [
          createGrant("approval", "manage", {
            scope: {
              runId: "run-25",
              approvalId: "approval-25",
              tool: "ticket.delete",
            },
          }),
          createGrant("approval", "deny", {
            scope: {
              runId: "run-25",
              approvalId: "approval-25",
              tool: "ticket.delete",
            },
            effect: "deny",
          }),
        ],
        expectedAllowed: true,
        expectedRequirement: {
          resource: "approval",
          action: "manage",
          scope: {
            runId: "run-25",
            approvalId: "approval-25",
            tool: "ticket.delete",
          },
        },
      },
      {
        title: "approval deny uses manage deny when the explicit deny is absent",
        action: "approval:deny",
        scope: {
          runId: "run-26",
          approvalId: "approval-26",
          tool: "ticket.delete",
        },
        grants: [
          createGrant("approval", "manage", {
            scope: {
              runId: "run-26",
              approvalId: "approval-26",
              tool: "ticket.delete",
            },
            effect: "deny",
          }),
          createGrant("approval", "deny", {
            scope: {
              runId: "run-26",
              approvalId: "approval-26",
              tool: "other",
            },
          }),
        ],
        expectedAllowed: false,
        expectedRequirement: {
          resource: "approval",
          action: "manage",
          scope: {
            runId: "run-26",
            approvalId: "approval-26",
            tool: "ticket.delete",
          },
        },
        expectedEffect: "deny",
      },
      {
        title: "checkpoint read ignores later run deny if checkpoint itself is allowed",
        action: "checkpoint:read",
        scope: { runId: "run-27", artifactId: "artifact-27" },
        grants: [
          createGrant("checkpoint", "read", {
            scope: { runId: "run-27", artifactId: "artifact-27" },
          }),
          createGrant("run", "read", {
            scope: { runId: "run-27" },
            effect: "deny",
          }),
        ],
        expectedAllowed: true,
        expectedRequirement: {
          resource: "checkpoint",
          action: "read",
          scope: { runId: "run-27", artifactId: "artifact-27" },
        },
      },
    ];

    for (const testCase of cases) {
      const decision = authorizeRuntimeAction(
        {
          action: testCase.action,
          ...(testCase.scope ? { scope: testCase.scope } : {}),
          ...(testCase.attributes ? { attributes: testCase.attributes } : {}),
        },
        testCase.grants,
      );
      expect(decision.allowed).toBe(testCase.expectedAllowed);
      expect(decision.matchedRequirement).toEqual(testCase.expectedRequirement);
      if (testCase.expectedEffect) {
        expect(decision.matchedGrant?.effect).toBe(testCase.expectedEffect);
      }
    }
  });

  it("keeps mixed scope and attribute combinations precise", () => {
    const cases: Array<{
      title: string;
      action: string;
      scope?: Record<string, string>;
      attributes?: Record<string, string>;
      expected: RequirementShape[];
    }> = [
      {
        title: "event read keeps only the run scope that matters",
        action: "event:read",
        scope: {
          runId: "run-30",
          approvalId: "",
          artifactId: "artifact-30",
        },
        expected: [
          {
            resource: "event",
            action: "read",
            scope: { runId: "run-30", artifactId: "artifact-30" },
          },
          { resource: "run", action: "read", scope: { runId: "run-30" } },
        ],
      },
      {
        title: "context read keeps run scope and ignores blank extras",
        action: "context:read",
        scope: {
          runId: "run-31",
          summaryId: " ",
          memoryId: "memory-31",
        },
        expected: [
          {
            resource: "context",
            action: "read",
            scope: { runId: "run-31", memoryId: "memory-31" },
          },
          { resource: "run", action: "read", scope: { runId: "run-31" } },
        ],
      },
      {
        title: "summary read keeps only the summary and fallback run scope",
        action: "summary:read",
        scope: {
          runId: "run-32",
          summaryId: "summary-32",
          tool: "",
        },
        expected: [
          {
            resource: "summary",
            action: "read",
            scope: { runId: "run-32", summaryId: "summary-32" },
          },
          { resource: "context", action: "read", scope: { runId: "run-32" } },
          { resource: "run", action: "read", scope: { runId: "run-32" } },
        ],
      },
      {
        title: "session memory adds the context and run fallback chain",
        action: "memory:read",
        scope: {
          runId: "run-33",
          memoryId: "memory-33",
          artifactId: "artifact-33",
        },
        attributes: { memoryKind: "session" },
        expected: [
          {
            resource: "memory",
            action: "read",
            scope: {
              runId: "run-33",
              memoryId: "memory-33",
              artifactId: "artifact-33",
            },
          },
          { resource: "context", action: "read", scope: { runId: "run-33" } },
          { resource: "run", action: "read", scope: { runId: "run-33" } },
        ],
      },
      {
        title: "persistent memory stays on the memory requirement only",
        action: "memory:read",
        scope: {
          runId: "run-34",
          memoryId: "memory-34",
          summaryId: "summary-34",
        },
        attributes: { memoryKind: "persistent" },
        expected: [
          {
            resource: "memory",
            action: "read",
            scope: {
              runId: "run-34",
              memoryId: "memory-34",
              summaryId: "summary-34",
            },
          },
        ],
      },
      {
        title: "approval approve keeps approval scope narrow and does not add fallbacks",
        action: "approval:approve",
        scope: {
          runId: "run-35",
          approvalId: "approval-35",
          tool: "ticket.delete",
        },
        expected: [
          {
            resource: "approval",
            action: "approve",
            scope: {
              runId: "run-35",
              approvalId: "approval-35",
              tool: "ticket.delete",
            },
          },
          {
            resource: "approval",
            action: "manage",
            scope: {
              runId: "run-35",
              approvalId: "approval-35",
              tool: "ticket.delete",
            },
          },
        ],
      },
      {
        title: "approval list keeps the full request scope without fallbacks",
        action: "approval:list",
        scope: {
          runId: "run-36",
          approvalId: "approval-36",
          tool: "ticket.delete",
        },
        expected: [
          {
            resource: "approval",
            action: "list",
            scope: {
              runId: "run-36",
              approvalId: "approval-36",
              tool: "ticket.delete",
            },
          },
        ],
      },
      {
        title: "runtime paths read stays without fallback scope",
        action: "runtime_paths:read",
        expected: [{ resource: "runtime_paths", action: "read" }],
      },
    ];

    for (const testCase of cases) {
      expect(
        summarizeRequirements(testCase.action, testCase.scope, testCase.attributes),
      ).toEqual(testCase.expected);
    }
  });
});
