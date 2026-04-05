import { describe, expect, it } from "bun:test";

import {
  assertValidGraphBindingResult,
  assertValidGraphEdgeRecord,
  assertValidGraphNodeRecord,
  assertValidGraphScope,
  assertValidGraphScopeRecord,
  assertValidGraphScopeSummary,
  assertValidGraphSearchResult,
} from "../../packages/ai/src/harness/graph/index.ts";
import type {
  HarnessGraphBindingResult,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
  HarnessGraphScopeRecord,
  HarnessGraphScopeSummary,
  HarnessGraphSearchResult,
} from "../../packages/ai/src/harness/graph/index.ts";

function scope(kind: HarnessGraphScope["kind"], id: string): HarnessGraphScope {
  switch (kind) {
    case "project":
      return { kind: "project", projectId: id };
    case "app":
      return { kind: "app", appId: id };
    case "run":
      return { kind: "run", runId: id };
    case "resource":
      return { kind: "resource", resourceType: "workspace", resourceId: id };
    case "capability":
      return { kind: "capability", capabilityId: id };
    case "policy":
      return { kind: "policy", policyId: id };
    case "entity":
      return { kind: "entity", entityType: "component", entityId: id };
  }
}

function baseScopeRecord(): HarnessGraphScopeRecord {
  return {
    id: "run__run-1",
    scope: scope("run", "run-1"),
    title: "Run: run-1",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    metadata: {
      source: "runtime",
    },
  };
}

function baseScopeSummary(): HarnessGraphScopeSummary {
  return {
    ...baseScopeRecord(),
    nodeCount: 3,
    edgeCount: 5,
    recentNodeIds: ["turn:1", "task:1"],
    recentEdgeIds: ["edge:1", "edge:2"],
  };
}

function baseNode(kind: HarnessGraphNodeRecord["kind"] = "turn"): HarnessGraphNodeRecord {
  return {
    id: `${kind}:1`,
    kind,
    scope: scope("run", "run-1"),
    title: `${kind} node`,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    runId: "run-1",
    status: "running",
    summary: "summary",
    content: "content",
    order: 0,
    sourceId: "source:1",
    relatedIds: ["related:1"],
    metadata: {
      source: "runtime",
    },
  };
}

function baseEdge(kind: HarnessGraphEdgeRecord["kind"] = "contains"): HarnessGraphEdgeRecord {
  return {
    id: `${kind}:1`,
    kind,
    scope: scope("run", "run-1"),
    from: "run:run-1",
    to: "turn:1",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    runId: "run-1",
    metadata: {
      source: "runtime",
    },
  };
}

function baseSearchResult(kind: HarnessGraphNodeRecord["kind"] = "turn"): HarnessGraphSearchResult {
  return {
    ...baseNode(kind),
    score: 1.5,
    matchedFields: ["title", "summary"],
    reasons: ["title overlap 1.000"],
  };
}

function baseBindingResult(): HarnessGraphBindingResult {
  return {
    scope: baseScopeRecord(),
    nodes: [baseNode("turn"), baseNode("task")],
    edges: [baseEdge("contains"), baseEdge("references")],
  };
}

describe("graph validation", () => {
  describe("graph scopes", () => {
    const validScopes: Array<[string, HarnessGraphScope]> = [
      ["project scope", scope("project", "capstan")],
      ["app scope", scope("app", "ops")],
      ["run scope", scope("run", "run-1")],
      ["resource scope", scope("resource", "alpha")],
      ["capability scope", scope("capability", "planner")],
      ["policy scope", scope("policy", "safety")],
      ["entity scope", scope("entity", "deployment")],
    ];

    for (const [name, value] of validScopes) {
      it(`accepts a valid ${name}`, () => {
        expect(() => assertValidGraphScope(value, name)).not.toThrow();
      });
    }

    const invalidScopes: Array<[string, unknown, RegExp]> = [
      ["non-object scope", null, /expected object/],
      ["array scope", [], /expected object/],
      ["missing kind", {}, /kind must be a non-empty string/],
      ["blank kind", { kind: "   " }, /kind must be a non-empty string/],
      ["unsupported kind", { kind: "workflow" }, /unsupported kind/],
      ["blank project id", { kind: "project", projectId: "   " }, /projectId must be a non-empty string/],
      ["blank app id", { kind: "app", appId: "   " }, /appId must be a non-empty string/],
      ["blank run id", { kind: "run", runId: "   " }, /runId must be a non-empty string/],
      [
        "blank resource type",
        { kind: "resource", resourceType: "   ", resourceId: "alpha" },
        /resourceType must be a non-empty string/,
      ],
      [
        "blank resource id",
        { kind: "resource", resourceType: "workspace", resourceId: "   " },
        /resourceId must be a non-empty string/,
      ],
      [
        "blank capability id",
        { kind: "capability", capabilityId: "   " },
        /capabilityId must be a non-empty string/,
      ],
      [
        "blank policy id",
        { kind: "policy", policyId: "   " },
        /policyId must be a non-empty string/,
      ],
      [
        "blank entity type",
        { kind: "entity", entityType: "   ", entityId: "alpha" },
        /entityType must be a non-empty string/,
      ],
      [
        "blank entity id",
        { kind: "entity", entityType: "deployment", entityId: "   " },
        /entityId must be a non-empty string/,
      ],
    ];

    for (const [name, value, error] of invalidScopes) {
      it(`rejects ${name}`, () => {
        expect(() => assertValidGraphScope(value, name)).toThrow(error);
      });
    }
  });

  describe("graph scope records and summaries", () => {
    it("accepts a fully populated scope record", () => {
      expect(() => assertValidGraphScopeRecord(baseScopeRecord(), "scope record")).not.toThrow();
    });

    it("accepts a fully populated scope summary", () => {
      expect(() => assertValidGraphScopeSummary(baseScopeSummary(), "scope summary")).not.toThrow();
    });

    const invalidRecords: Array<[string, unknown, RegExp]> = [
      ["scope record non-object", null, /expected object/],
      ["scope record blank id", { ...baseScopeRecord(), id: "   " }, /id must be a non-empty string/],
      ["scope record blank title", { ...baseScopeRecord(), title: "   " }, /title must be a non-empty string/],
      [
        "scope record blank createdAt",
        { ...baseScopeRecord(), createdAt: "   " },
        /createdAt must be a non-empty string/,
      ],
      [
        "scope record blank updatedAt",
        { ...baseScopeRecord(), updatedAt: "   " },
        /updatedAt must be a non-empty string/,
      ],
      [
        "scope record invalid metadata",
        { ...baseScopeRecord(), metadata: [] },
        /metadata must be an object/,
      ],
      [
        "scope summary negative node count",
        { ...baseScopeSummary(), nodeCount: -1 },
        /nodeCount must be a non-negative integer/,
      ],
      [
        "scope summary fractional edge count",
        { ...baseScopeSummary(), edgeCount: 1.25 },
        /edgeCount must be a non-negative integer/,
      ],
      [
        "scope summary invalid recentNodeIds",
        { ...baseScopeSummary(), recentNodeIds: [1] },
        /recentNodeIds must be a string array/,
      ],
      [
        "scope summary invalid recentEdgeIds",
        { ...baseScopeSummary(), recentEdgeIds: [true] },
        /recentEdgeIds must be a string array/,
      ],
    ];

    for (const [name, value, error] of invalidRecords) {
      it(`rejects ${name}`, () => {
        const validator = name.startsWith("scope summary")
          ? assertValidGraphScopeSummary
          : assertValidGraphScopeRecord;
        expect(() => validator(value, name)).toThrow(error);
      });
    }
  });

  describe("graph nodes", () => {
    const validNodeKinds: HarnessGraphNodeRecord["kind"][] = [
      "run",
      "turn",
      "checkpoint",
      "task",
      "artifact",
      "memory",
      "approval",
    ];

    for (const kind of validNodeKinds) {
      it(`accepts a valid ${kind} node`, () => {
        expect(() => assertValidGraphNodeRecord(baseNode(kind), `${kind} node`)).not.toThrow();
      });
    }

    const invalidNodes: Array<[string, unknown, RegExp]> = [
      ["node non-object", null, /expected object/],
      ["node blank id", { ...baseNode(), id: "   " }, /id must be a non-empty string/],
      ["node blank kind", { ...baseNode(), kind: "   " }, /kind must be a non-empty string/],
      ["node unsupported kind", { ...baseNode(), kind: "workflow" }, /unsupported kind/],
      ["node invalid scope", { ...baseNode(), scope: null }, /scope is invalid/],
      ["node blank title", { ...baseNode(), title: "   " }, /title must be a non-empty string/],
      ["node blank createdAt", { ...baseNode(), createdAt: "   " }, /createdAt must be a non-empty string/],
      ["node blank updatedAt", { ...baseNode(), updatedAt: "   " }, /updatedAt must be a non-empty string/],
      ["node blank runId", { ...baseNode(), runId: "   " }, /runId must be a non-empty string/],
      ["node blank status", { ...baseNode(), status: "   " }, /status must be a non-empty string/],
      ["node invalid summary", { ...baseNode(), summary: 1 }, /summary must be a string/],
      ["node invalid content", { ...baseNode(), content: 1 }, /content must be a string/],
      ["node invalid order", { ...baseNode(), order: -1 }, /order must be a non-negative integer/],
      ["node invalid sourceId", { ...baseNode(), sourceId: "   " }, /sourceId must be a non-empty string/],
      ["node invalid relatedIds", { ...baseNode(), relatedIds: ["ok", 1] }, /relatedIds must be a string array/],
      ["node invalid metadata", { ...baseNode(), metadata: [] }, /metadata must be an object/],
    ];

    for (const [name, value, error] of invalidNodes) {
      it(`rejects ${name}`, () => {
        expect(() => assertValidGraphNodeRecord(value, name)).toThrow(error);
      });
    }
  });

  describe("graph edges", () => {
    const validEdgeKinds: HarnessGraphEdgeRecord["kind"][] = [
      "contains",
      "follows",
      "references",
      "generates",
      "summarizes",
      "promotes",
      "approves",
      "blocks",
    ];

    for (const kind of validEdgeKinds) {
      it(`accepts a valid ${kind} edge`, () => {
        expect(() => assertValidGraphEdgeRecord(baseEdge(kind), `${kind} edge`)).not.toThrow();
      });
    }

    const invalidEdges: Array<[string, unknown, RegExp]> = [
      ["edge non-object", null, /expected object/],
      ["edge blank id", { ...baseEdge(), id: "   " }, /id must be a non-empty string/],
      ["edge blank kind", { ...baseEdge(), kind: "   " }, /kind must be a non-empty string/],
      ["edge unsupported kind", { ...baseEdge(), kind: "workflow" }, /unsupported kind/],
      ["edge invalid scope", { ...baseEdge(), scope: null }, /scope is invalid/],
      ["edge blank from", { ...baseEdge(), from: "   " }, /from must be a non-empty string/],
      ["edge blank to", { ...baseEdge(), to: "   " }, /to must be a non-empty string/],
      ["edge blank createdAt", { ...baseEdge(), createdAt: "   " }, /createdAt must be a non-empty string/],
      ["edge blank updatedAt", { ...baseEdge(), updatedAt: "   " }, /updatedAt must be a non-empty string/],
      ["edge blank runId", { ...baseEdge(), runId: "   " }, /runId must be a non-empty string/],
      ["edge invalid metadata", { ...baseEdge(), metadata: [] }, /metadata must be an object/],
    ];

    for (const [name, value, error] of invalidEdges) {
      it(`rejects ${name}`, () => {
        expect(() => assertValidGraphEdgeRecord(value, name)).toThrow(error);
      });
    }
  });

  describe("graph search results", () => {
    it("accepts a well-formed search result", () => {
      expect(() => assertValidGraphSearchResult(baseSearchResult(), "search result")).not.toThrow();
    });

    const invalidSearchResults: Array<[string, unknown, RegExp]> = [
      ["search result non-object", null, /expected object/],
      ["search result bad score", { ...baseSearchResult(), score: Number.NaN }, /score must be a finite number/],
      ["search result infinite score", { ...baseSearchResult(), score: Infinity }, /score must be a finite number/],
      ["search result invalid matchedFields", { ...baseSearchResult(), matchedFields: [1] }, /matchedFields must be a string array/],
      ["search result invalid reasons", { ...baseSearchResult(), reasons: [1] }, /reasons must be a string array/],
      ["search result invalid node kind", { ...baseSearchResult(), kind: "workflow" }, /unsupported kind/],
    ];

    for (const [name, value, error] of invalidSearchResults) {
      it(`rejects ${name}`, () => {
        expect(() => assertValidGraphSearchResult(value, name)).toThrow(error);
      });
    }
  });

  describe("graph binding results", () => {
    it("accepts a well-formed binding result", () => {
      expect(() => assertValidGraphBindingResult(baseBindingResult(), "binding result")).not.toThrow();
    });

    const invalidBindingResults: Array<[string, unknown, RegExp]> = [
      ["binding result non-object", null, /expected object/],
      ["binding result missing scope", { ...baseBindingResult(), scope: undefined }, /scope is invalid/],
      ["binding result invalid nodes container", { ...baseBindingResult(), nodes: {} }, /nodes must be an array/],
      ["binding result invalid edges container", { ...baseBindingResult(), edges: {} }, /edges must be an array/],
      [
        "binding result invalid node element",
        { ...baseBindingResult(), nodes: [baseNode(), { ...baseNode(), id: " " }] },
        /nodes\[1\].id must be a non-empty string/,
      ],
      [
        "binding result invalid edge element",
        { ...baseBindingResult(), edges: [baseEdge(), { ...baseEdge(), id: " " }] },
        /edges\[1\].id must be a non-empty string/,
      ],
    ];

    for (const [name, value, error] of invalidBindingResults) {
      it(`rejects ${name}`, () => {
        expect(() => assertValidGraphBindingResult(value, name)).toThrow(error);
      });
    }
  });

  describe("field-by-field rejection matrix", () => {
    const scopeFailures: Array<[string, unknown, RegExp]> = [
      ["scope object missing projectId", { kind: "project" }, /projectId must be a non-empty string/],
      ["scope object missing appId", { kind: "app" }, /appId must be a non-empty string/],
      ["scope object missing runId", { kind: "run" }, /runId must be a non-empty string/],
      [
        "scope object missing resourceType",
        { kind: "resource", resourceId: "alpha" },
        /resourceType must be a non-empty string/,
      ],
      [
        "scope object missing resourceId",
        { kind: "resource", resourceType: "workspace" },
        /resourceId must be a non-empty string/,
      ],
      [
        "scope object missing capabilityId",
        { kind: "capability" },
        /capabilityId must be a non-empty string/,
      ],
      ["scope object missing policyId", { kind: "policy" }, /policyId must be a non-empty string/],
      [
        "scope object missing entityType",
        { kind: "entity", entityId: "alpha" },
        /entityType must be a non-empty string/,
      ],
      [
        "scope object missing entityId",
        { kind: "entity", entityType: "deployment" },
        /entityId must be a non-empty string/,
      ],
    ];

    for (const [name, value, error] of scopeFailures) {
      it(`rejects ${name}`, () => {
        expect(() => assertValidGraphScope(value, name)).toThrow(error);
      });
    }

    const nodeFailures: Array<[string, unknown, RegExp]> = [
      ["run node blank status", { ...baseNode("run"), status: "   " }, /must be a non-empty string/],
      ["turn node missing summary is allowed", { ...baseNode("turn"), summary: undefined }, /.*/],
      ["turn node missing content is allowed", { ...baseNode("turn"), content: undefined }, /.*/],
      ["task node invalid order type", { ...baseNode("task"), order: "1" }, /order must be a non-negative integer/],
      ["artifact node invalid metadata type", { ...baseNode("artifact"), metadata: "oops" }, /metadata must be an object/],
      ["memory node invalid relatedIds", { ...baseNode("memory"), relatedIds: [null] }, /relatedIds must be a string array/],
      ["approval node invalid sourceId", { ...baseNode("approval"), sourceId: "" }, /sourceId must be a non-empty string/],
      ["checkpoint node invalid scope", { ...baseNode("checkpoint"), scope: [] }, /scope is invalid/],
      ["node invalid createdAt", { ...baseNode("turn"), createdAt: 123 }, /createdAt must be a non-empty string/],
      ["node invalid updatedAt", { ...baseNode("turn"), updatedAt: 123 }, /updatedAt must be a non-empty string/],
      ["node invalid runId", { ...baseNode("turn"), runId: 123 }, /runId must be a non-empty string/],
      ["node invalid status", { ...baseNode("turn"), status: 123 }, /status must be a non-empty string/],
    ];

    for (const [name, value, error] of nodeFailures) {
      it(`rejects ${name}`, () => {
        if (error.source === ".*") {
          expect(() => assertValidGraphNodeRecord(value, name)).not.toThrow();
          return;
        }
        expect(() => assertValidGraphNodeRecord(value, name)).toThrow(error);
      });
    }

    const edgeFailures: Array<[string, unknown, RegExp]> = [
      ["edge missing from", { ...baseEdge("contains"), from: undefined }, /from must be a non-empty string/],
      ["edge missing to", { ...baseEdge("contains"), to: undefined }, /to must be a non-empty string/],
      ["edge missing runId is allowed", { ...baseEdge("contains"), runId: undefined }, /.*/],
      ["edge invalid scope", { ...baseEdge("contains"), scope: { kind: "run" } }, /runId must be a non-empty string/],
      ["edge invalid metadata type", { ...baseEdge("contains"), metadata: 1 }, /metadata must be an object/],
      ["edge invalid createdAt", { ...baseEdge("contains"), createdAt: false }, /createdAt must be a non-empty string/],
      ["edge invalid updatedAt", { ...baseEdge("contains"), updatedAt: false }, /updatedAt must be a non-empty string/],
    ];

    for (const [name, value, error] of edgeFailures) {
      it(`rejects ${name}`, () => {
        if (error.source === ".*") {
          expect(() => assertValidGraphEdgeRecord(value, name)).not.toThrow();
          return;
        }
        expect(() => assertValidGraphEdgeRecord(value, name)).toThrow(error);
      });
    }
  });
});
