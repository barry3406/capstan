import { describe, expect, it } from "bun:test";

import {
  buildGraphContextBlock,
  buildGraphContextBlocks,
  buildHarnessGraphPaths,
  collectGraphContextNodes,
  compareTimestampDescendingThenId,
  createProjectGraphScope,
  createRunGraphScope,
  encodeGraphPathSegment,
  encodeGraphPathSegmentForFilePath,
  extractGraphSearchText,
  formatHarnessGraphScopeKey,
  formatHarnessGraphScopeTitle,
  graphEdgeMatchesQuery,
  graphNodeMatchesQuery,
  graphNodeSearchText,
  graphScopeKey,
  graphScopesIntersect,
  memoryScopeToGraphScope,
  mergeGraphScopes,
  normalizeGraphScope,
  normalizeGraphScopes,
  queryHarnessGraph,
  resolveHarnessGraphEdgeFilePath,
  resolveHarnessGraphNodeFilePath,
  resolveHarnessGraphScopeFilePath,
  scoreGraphNode,
  selectGraphNodesForContext,
  sortGraphEdges,
  sortGraphNodes,
  scopesEqual,
  stripUndefinedGraphValue,
} from "../../packages/ai/src/harness/graph/index.ts";
import {
  scoreTokenOverlap,
  tokenizeGraphQuery,
} from "../../packages/ai/src/harness/graph/utils.ts";
import type {
  HarnessGraphEdgeFilter,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeFilter,
  HarnessGraphNodeQuery,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
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

function node(
  id: string,
  patch: Partial<HarnessGraphNodeRecord> = {},
): HarnessGraphNodeRecord {
  return {
    id,
    kind: patch.kind ?? "turn",
    scope: patch.scope ?? scope("run", "run-1"),
    title: patch.title ?? `Node ${id}`,
    createdAt: patch.createdAt ?? "2026-04-03T00:00:00.000Z",
    updatedAt: patch.updatedAt ?? "2026-04-03T00:00:00.000Z",
    runId: patch.runId,
    status: patch.status,
    summary: patch.summary,
    content: patch.content,
    order: patch.order,
    sourceId: patch.sourceId,
    relatedIds: patch.relatedIds,
    metadata: patch.metadata,
  };
}

function edge(
  id: string,
  patch: Partial<HarnessGraphEdgeRecord> = {},
): HarnessGraphEdgeRecord {
  return {
    id,
    kind: patch.kind ?? "contains",
    scope: patch.scope ?? scope("run", "run-1"),
    from: patch.from ?? "run:run-1",
    to: patch.to ?? "turn:run-1:1",
    createdAt: patch.createdAt ?? "2026-04-03T00:00:00.000Z",
    updatedAt: patch.updatedAt ?? "2026-04-03T00:00:00.000Z",
    runId: patch.runId,
    metadata: patch.metadata,
  };
}

function captureNodeQuery() {
  const calls: HarnessGraphNodeQuery[] = [];
  const edgeCalls: HarnessGraphEdgeFilter[] = [];
  const store = {
    async listNodes(query?: HarnessGraphNodeQuery): Promise<HarnessGraphNodeRecord[]> {
      calls.push(query ?? {});
      return [];
    },
    async listEdges(query?: HarnessGraphEdgeFilter): Promise<HarnessGraphEdgeRecord[]> {
      edgeCalls.push(query ?? {});
      return [];
    },
  };
  return { calls, edgeCalls, store };
}

describe("graph utils", () => {
  describe("scope normalization and key helpers", () => {
    const cases = [
      {
        name: "keeps project scopes canonical and trimmed",
        input: { kind: "project" as const, projectId: "  capstan  " },
        expected: { kind: "project" as const, projectId: "capstan" },
        key: "project__capstan",
        title: "Project: capstan",
      },
      {
        name: "keeps app scopes canonical and trimmed",
        input: { kind: "app" as const, appId: "  ops  " },
        expected: { kind: "app" as const, appId: "ops" },
        key: "app__ops",
        title: "App: ops",
      },
      {
        name: "keeps run scopes canonical and trimmed",
        input: { kind: "run" as const, runId: "  run-1  " },
        expected: { kind: "run" as const, runId: "run-1" },
        key: "run__run-1",
        title: "Run: run-1",
      },
      {
        name: "keeps resource scopes canonical and trimmed",
        input: {
          kind: "resource" as const,
          resourceType: "  workspace  ",
          resourceId: "  alpha/beta  ",
        },
        expected: {
          kind: "resource" as const,
          resourceType: "workspace",
          resourceId: "alpha/beta",
        },
        key: "resource__workspace__alpha_beta",
        title: "Resource: workspace/alpha/beta",
      },
      {
        name: "keeps capability scopes canonical and trimmed",
        input: { kind: "capability" as const, capabilityId: "  planner  " },
        expected: { kind: "capability" as const, capabilityId: "planner" },
        key: "capability__planner",
        title: "Capability: planner",
      },
      {
        name: "keeps policy scopes canonical and trimmed",
        input: { kind: "policy" as const, policyId: "  safety  " },
        expected: { kind: "policy" as const, policyId: "safety" },
        key: "policy__safety",
        title: "Policy: safety",
      },
      {
        name: "keeps entity scopes canonical and trimmed",
        input: {
          kind: "entity" as const,
          entityType: "  deployment  ",
          entityId: "  release-1  ",
        },
        expected: {
          kind: "entity" as const,
          entityType: "deployment",
          entityId: "release-1",
        },
        key: "entity__deployment__release-1",
        title: "Entity: deployment/release-1",
      },
      {
        name: "normalizes mixed graph scope arrays and removes duplicates",
        input: [
          { kind: "project" as const, projectId: " capstan " },
          { kind: "project" as const, projectId: "capstan" },
          { kind: "run" as const, runId: " run-1 " },
          { kind: "run" as const, runId: "run-1" },
        ],
        expected: [
          { kind: "project" as const, projectId: "capstan" },
          { kind: "run" as const, runId: "run-1" },
        ],
      },
      {
        name: "merges graph scope groups into a stable deduplicated list",
        input: [
          [
            { kind: "project" as const, projectId: "capstan" },
            { kind: "app" as const, appId: "ops" },
          ],
          [
            { kind: "app" as const, appId: "ops" },
            { kind: "run" as const, runId: "run-1" },
          ],
          undefined,
        ],
        expected: [
          { kind: "project" as const, projectId: "capstan" },
          { kind: "app" as const, appId: "ops" },
          { kind: "run" as const, runId: "run-1" },
        ],
      },
      {
        name: "treats scope keys as identical when only whitespace differs",
        left: { kind: "project" as const, projectId: "capstan" },
        right: { kind: "project" as const, projectId: " capstan " },
        expected: true,
      },
      {
        name: "treats different scope kinds as distinct even when ids match",
        left: { kind: "project" as const, projectId: "capstan" },
        right: { kind: "run" as const, runId: "capstan" },
        expected: false,
      },
      {
        name: "treats resource scopes with different ids as distinct",
        left: {
          kind: "resource" as const,
          resourceType: "workspace",
          resourceId: "alpha",
        },
        right: {
          kind: "resource" as const,
          resourceType: "workspace",
          resourceId: "beta",
        },
        expected: false,
      },
    ] satisfies Array<
      | {
          name: string;
          input: HarnessGraphScope;
          expected: HarnessGraphScope;
          key: string;
          title: string;
        }
      | {
          name: string;
          input: readonly HarnessGraphScope[];
          expected: readonly HarnessGraphScope[];
        }
      | {
          name: string;
          input: Array<readonly HarnessGraphScope[] | undefined>;
          expected: readonly HarnessGraphScope[];
        }
      | {
          name: string;
          left: HarnessGraphScope;
          right: HarnessGraphScope;
          expected: boolean;
        }
    >;

    for (const testCase of cases) {
      it(testCase.name, () => {
        if ("input" in testCase && Array.isArray(testCase.input) && "kind" in (testCase.input[0] ?? {})) {
          const normalized = normalizeGraphScopes(testCase.input as readonly HarnessGraphScope[]);
          expect(normalized).toEqual(testCase.expected);
          expect(normalized.map((value) => graphScopeKey(value))).toEqual(
            testCase.expected.map((value) => graphScopeKey(value)),
          );
          return;
        }

        if ("input" in testCase && Array.isArray(testCase.input) && !("kind" in (testCase.input[0] ?? {}))) {
          expect(mergeGraphScopes(...(testCase.input as Array<readonly HarnessGraphScope[] | undefined>))).toEqual(
            testCase.expected,
          );
          return;
        }

        if ("left" in testCase) {
          expect(scopesEqual(testCase.left, testCase.right)).toBe(testCase.expected);
          expect(graphScopeKey(testCase.left)).toBe(graphScopeKey(normalizeGraphScope(testCase.left)));
          return;
        }

        const normalized = normalizeGraphScope(testCase.input);
        expect(normalized).toEqual(testCase.expected);
        expect(graphScopeKey(testCase.input)).toBe(testCase.key);
        expect(formatHarnessGraphScopeKey(testCase.input)).toBe(testCase.key);
        expect(formatHarnessGraphScopeTitle(normalized)).toBe(testCase.title);
      });
    }

    it("creates canonical project and run scopes with validation", () => {
      expect(createProjectGraphScope("  capstan  ")).toEqual({
        kind: "project",
        projectId: "capstan",
      });
      expect(createRunGraphScope("  run-1  ")).toEqual({
        kind: "run",
        runId: "run-1",
      });
    });

    it("rejects empty scope identifiers through the creation helpers", () => {
      expect(() => createProjectGraphScope("   ")).toThrow(/projectId/);
      expect(() => createRunGraphScope("")).toThrow(/runId/);
    });
  });

  describe("memory scope conversion", () => {
    const cases = [
      {
        name: "maps project memory scopes to project graph scopes",
        input: { type: "project", id: "capstan" },
        expected: { kind: "project", projectId: "capstan" },
      },
      {
        name: "maps run memory scopes to run graph scopes",
        input: { type: "run", id: "run-1" },
        expected: { kind: "run", runId: "run-1" },
      },
      {
        name: "maps app memory scopes to app graph scopes",
        input: { type: "app", id: "ops" },
        expected: { kind: "app", appId: "ops" },
      },
      {
        name: "maps capability memory scopes to capability graph scopes",
        input: { type: "capability", id: "planner" },
        expected: { kind: "capability", capabilityId: "planner" },
      },
      {
        name: "maps policy memory scopes to policy graph scopes",
        input: { type: "policy", id: "safety" },
        expected: { kind: "policy", policyId: "safety" },
      },
      {
        name: "treats unknown memory scope types as entity scopes",
        input: { type: "workflow", id: "release" },
        expected: {
          kind: "entity",
          entityType: "workflow",
          entityId: "release",
        },
      },
      {
        name: "trims memory scope identifiers before conversion",
        input: { type: "project", id: "  capstan  " },
        expected: { kind: "project", projectId: "capstan" },
      },
      {
        name: "keeps punctuation in memory scope identifiers as entity data",
        input: { type: "release:phase", id: "draft/1" },
        expected: {
          kind: "entity",
          entityType: "release:phase",
          entityId: "draft/1",
        },
      },
    ] as const;

    for (const testCase of cases) {
      it(testCase.name, () => {
        expect(memoryScopeToGraphScope(testCase.input)).toEqual(testCase.expected);
      });
    }

    it("rejects blank memory scope type and id fields", () => {
      expect(() => memoryScopeToGraphScope({ type: " ", id: "capstan" })).toThrow(
        /memoryScope.type/,
      );
      expect(() => memoryScopeToGraphScope({ type: "project", id: " " })).toThrow(
        /memoryScope.id/,
      );
    });
  });

  describe("scope intersection and matching", () => {
    const graphScope = scope("run", "run-1");
    const otherScope = scope("project", "capstan");
    const nodeScope = scope("run", "run-1");
    const resourceScope = scope("resource", "alpha");

    it("treats an undefined right-hand scope filter as a match", () => {
      expect(graphScopesIntersect([graphScope], undefined)).toBe(true);
      expect(graphScopesIntersect([graphScope], [])).toBe(true);
    });

    it("detects intersections across mixed scope lists", () => {
      expect(graphScopesIntersect([graphScope, otherScope], [otherScope])).toBe(true);
      expect(graphScopesIntersect([graphScope, otherScope], [resourceScope])).toBe(false);
    });

    it("matches nodes when graphScopes metadata expands the node scope", () => {
      const record = node("turn:1", {
        metadata: {
          graphScopes: [
            { kind: "project", projectId: "capstan" },
            { kind: "run", runId: "run-1" },
          ],
        },
      });
      expect(graphNodeMatchesQuery(record, { scopes: [graphScope] })).toBe(true);
      expect(graphNodeMatchesQuery(record, { scopes: [scope("project", "capstan")] })).toBe(true);
      expect(graphNodeMatchesQuery(record, { scopes: [scope("resource", "alpha")] })).toBe(false);
    });

    it("matches edges only when the scope filter overlaps the edge scope", () => {
      const record = edge("edge-1", {
        scope: scope("project", "capstan"),
      });
      expect(graphEdgeMatchesQuery(record, { scopes: [scope("project", "capstan")] })).toBe(true);
      expect(graphEdgeMatchesQuery(record, { scopes: [scope("run", "run-1")] })).toBe(false);
    });

    it("applies kind, id, and run filters before scope checks", () => {
      const record = node("turn:3", {
        kind: "turn",
        runId: "run-1",
        scope: scope("run", "run-1"),
      });
      const query: HarnessGraphNodeFilter = {
        kinds: ["turn"],
        ids: ["turn:3"],
        runId: "run-1",
        scopes: [scope("run", "run-1")],
      };
      expect(graphNodeMatchesQuery(record, query)).toBe(true);
      expect(graphNodeMatchesQuery(record, { ...query, kinds: ["run"] })).toBe(false);
      expect(graphNodeMatchesQuery(record, { ...query, ids: ["missing"] })).toBe(false);
      expect(graphNodeMatchesQuery(record, { ...query, runId: "run-2" })).toBe(false);
    });

    it("applies edge ids and endpoint filters before scope checks", () => {
      const record = edge("edge-2", {
        kind: "references",
        from: "task:1",
        to: "artifact:1",
        scope: scope("run", "run-1"),
        runId: "run-1",
      });
      const query: HarnessGraphEdgeFilter = {
        kinds: ["references"],
        ids: ["edge-2"],
        fromIds: ["task:1"],
        toIds: ["artifact:1"],
        runId: "run-1",
        scopes: [scope("run", "run-1")],
      };
      expect(graphEdgeMatchesQuery(record, query)).toBe(true);
      expect(graphEdgeMatchesQuery(record, { ...query, fromIds: ["run:1"] })).toBe(false);
      expect(graphEdgeMatchesQuery(record, { ...query, toIds: ["turn:1"] })).toBe(false);
    });
  });

  describe("path encoding and filesystem layout", () => {
    const rootDir = "/tmp/capstan-graph-utils";
    const paths = buildHarnessGraphPaths(rootDir);

    const cases = [
      {
        name: "collapses whitespace and punctuation into safe path segments",
        input: " turn/1:alpha beta ",
        expected: "turn_1_alpha_beta",
      },
      {
        name: "preserves dot and dash characters that are path-safe",
        input: "release-1.2.3",
        expected: "release-1.2.3",
      },
      {
        name: "normalizes repeated separators into a single underscore",
        input: "hello---world///again",
        expected: "hello---world_again",
      },
      {
        name: "drops leading and trailing unsafe characters",
        input: "__//alpha__beta//__",
        expected: "alpha_beta",
      },
      {
        name: "falls back to unknown when the sanitized segment would be empty",
        input: "////",
        expected: "unknown",
      },
      {
        name: "preserves ascii letters and numbers",
        input: "Run123",
        expected: "Run123",
      },
      {
        name: "uses the same sanitizer for graph scope keys and file segments",
        input: "workspace:alpha/beta",
        expected: "workspace_alpha_beta",
      },
    ] as const;

    for (const testCase of cases) {
      it(testCase.name, () => {
        expect(encodeGraphPathSegment(testCase.input)).toBe(testCase.expected);
      });
    }

    it("builds the runtime graph directory layout under the harness root", () => {
      expect(paths.graphRootDir).toBe("/tmp/capstan-graph-utils/.capstan/harness/graph");
      expect(paths.scopesDir).toBe("/tmp/capstan-graph-utils/.capstan/harness/graph/scopes");
      expect(paths.nodesDir).toBe("/tmp/capstan-graph-utils/.capstan/harness/graph/nodes");
      expect(paths.edgesDir).toBe("/tmp/capstan-graph-utils/.capstan/harness/graph/edges");
      expect(paths.projectionsDir).toBe(
        "/tmp/capstan-graph-utils/.capstan/harness/graph/projections",
      );
    });

    it("resolves scope, node, and edge paths through canonical graph keys", () => {
      const scopeRecord = scope("run", "run/alpha");
      const nodeRecord = node("turn/1:weird", {
        scope: scopeRecord,
        kind: "turn",
      });
      const edgeRecord = edge("edge/1:weird", {
        scope: scopeRecord,
        kind: "references",
        from: "run:alpha",
        to: "turn:alpha:1",
      });

      expect(resolveHarnessGraphScopeFilePath(paths, scopeRecord)).toBe(
        "/tmp/capstan-graph-utils/.capstan/harness/graph/scopes/run__run_alpha.json",
      );
      expect(resolveHarnessGraphNodeFilePath(paths, nodeRecord)).toBe(
        "/tmp/capstan-graph-utils/.capstan/harness/graph/nodes/run__run_alpha/turn/turn_1_weird.json",
      );
      expect(resolveHarnessGraphEdgeFilePath(paths, edgeRecord)).toBe(
        "/tmp/capstan-graph-utils/.capstan/harness/graph/edges/run__run_alpha/references/edge_1_weird.json",
      );
    });

    it("rejects empty path segments through the sanitizer", () => {
      expect(() => encodeGraphPathSegment("   ")).toThrow(/path segment/);
    });

    it("shortens oversized path segments without affecting short canonical ones", () => {
      const longSegment = `project__${"runtime-root-".repeat(18)}${"x".repeat(64)}`;
      const encoded = encodeGraphPathSegmentForFilePath(longSegment);

      expect(encoded).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(encoded.length).toBeLessThanOrEqual(80);
      expect(encodeGraphPathSegmentForFilePath("run__run_alpha")).toBe("run__run_alpha");
      expect(encodeGraphPathSegmentForFilePath(longSegment)).toBe(encoded);
    });
  });

  describe("stripUndefinedGraphValue", () => {
    const cases = [
      {
        name: "drops undefined object fields without touching nulls or booleans",
        input: {
          keep: true,
          remove: undefined,
          zero: 0,
          nil: null,
        },
        expected: {
          keep: true,
          zero: 0,
          nil: null,
        },
      },
      {
        name: "recursively strips nested objects",
        input: {
          a: {
            b: undefined,
            c: {
              d: "keep",
              e: undefined,
            },
          },
        },
        expected: {
          a: {
            c: {
              d: "keep",
            },
          },
        },
      },
      {
        name: "preserves arrays while stripping undefined entries from them",
        input: [
          "keep",
          undefined,
          {
            nested: undefined,
            stable: "value",
          },
          [undefined, "inner"],
        ],
        expected: [
          "keep",
          {
            stable: "value",
          },
          ["inner"],
        ],
      },
      {
        name: "leaves empty objects and arrays intact after stripping undefined fields",
        input: {
          emptyObject: {
            remove: undefined,
          },
          emptyArray: [undefined, undefined],
        },
        expected: {
          emptyObject: {},
          emptyArray: [],
        },
      },
      {
        name: "retains numbers, strings, and nested metadata structures",
        input: {
          title: "Graph record",
          order: 0,
          metadata: {
            source: "runtime",
            detail: {
              kind: "turn",
              extra: undefined,
            },
          },
        },
        expected: {
          title: "Graph record",
          order: 0,
          metadata: {
            source: "runtime",
            detail: {
              kind: "turn",
            },
          },
        },
      },
    ] as const;

    for (const testCase of cases) {
      it(testCase.name, () => {
        expect(stripUndefinedGraphValue(testCase.input)).toEqual(testCase.expected);
      });
    }
  });

  describe("query normalization and retrieval wiring", () => {
    it("omits undefined node query fields before delegating to the store", async () => {
      const { calls, edgeCalls, store } = captureNodeQuery();
      await collectGraphContextNodes(store, {
        text: "deploy release",
        scopes: [scope("run", "run-1")],
        kinds: ["turn", "task"],
        ids: undefined,
        runId: undefined,
        relatedTo: undefined,
        limit: 8,
        minScore: 0.25,
      });

      expect(calls).toHaveLength(1);
      expect(edgeCalls).toHaveLength(1);
      expect(calls[0]).toEqual({
        scopes: [scope("run", "run-1")],
        kinds: ["turn", "task"],
      });
    });

    it("injects relatedTo from the run-scoped overload and keeps the explicit query text", async () => {
      const calls: HarnessGraphNodeQuery[] = [];
      const edgeCalls: HarnessGraphEdgeFilter[] = [];
      const store = {
        async listNodes(query?: HarnessGraphNodeQuery): Promise<HarnessGraphNodeRecord[]> {
          calls.push(query ?? {});
          return [];
        },
        async listEdges(query?: HarnessGraphEdgeFilter): Promise<HarnessGraphEdgeRecord[]> {
          edgeCalls.push(query ?? {});
          return [];
        },
      };

      await collectGraphContextNodes({
        runtimeStore: store,
        runId: "run-1",
        query: "release summary",
        scopes: [scope("project", "capstan"), scope("project", "capstan")],
        kinds: ["memory"],
        limit: 5,
      });

      expect(calls).toHaveLength(1);
      expect(edgeCalls).toHaveLength(1);
      expect(calls[0]).toEqual({
        scopes: [scope("project", "capstan"), scope("project", "capstan")],
        kinds: ["memory"],
      });
    });

    it("falls back to the graph query path when the store implements listEdges and listNodes", async () => {
      const graphScope = scope("run", "run-1");
      const nodes = [
        node("turn:1", {
          kind: "turn",
          scope: graphScope,
          title: "Deploy release",
          summary: "release deployment",
          content: "deploy release now",
          updatedAt: "2026-04-03T00:10:00.000Z",
        }),
        node("memory:1", {
          kind: "memory",
          scope: graphScope,
          title: "Release memory",
          summary: "release summary",
          content: "remember the release",
          updatedAt: "2026-04-03T00:09:00.000Z",
        }),
      ];
      const edges = [
        edge("edge:1", {
          kind: "contains",
          scope: graphScope,
          from: "run:run-1",
          to: "turn:1",
        }),
      ];
      const store = {
        async listNodes(query?: HarnessGraphNodeQuery): Promise<HarnessGraphNodeRecord[]> {
          expect(query).toEqual({
            scopes: [graphScope],
            kinds: ["turn", "memory"],
          });
          return nodes;
        },
        async listEdges(query?: HarnessGraphEdgeFilter): Promise<HarnessGraphEdgeRecord[]> {
          expect(query).toEqual({ scopes: [graphScope] });
          return edges;
        },
      };

      const ranked = await queryHarnessGraph(store, {
        text: "release",
        scopes: [graphScope],
        kinds: ["turn", "memory"],
        relatedTo: "run:run-1",
        limit: 2,
        minScore: 0,
      });

      expect(ranked.map((entry) => entry.id)).toEqual(["turn:1", "memory:1"]);
      expect(ranked[0]!.matchedFields).toContain("title");
      expect(ranked[0]!.reasons.join(" ")).toContain("related distance");
    });

    it("normalizes edge queries when graph adjacency data is read directly", async () => {
      const graphScope = scope("project", "capstan");
      const calls: HarnessGraphEdgeFilter[] = [];
      const store = {
        async listNodes(query?: HarnessGraphNodeQuery): Promise<HarnessGraphNodeRecord[]> {
          expect(query).toEqual({
            scopes: [graphScope],
            kinds: ["turn"],
          });
          return [
            node("turn:1", {
              kind: "turn",
              scope: graphScope,
              title: "Release turn",
              summary: "release summary",
              content: "release content",
            }),
          ];
        },
        async listEdges(query?: HarnessGraphEdgeFilter): Promise<HarnessGraphEdgeRecord[]> {
          calls.push(query ?? {});
          return [];
        },
      };

      const ranked = await queryHarnessGraph(store, {
        text: "release",
        scopes: [graphScope],
        kinds: ["turn"],
        relatedTo: "turn:seed",
        limit: 4,
        minScore: 0.1,
      });

      expect(calls).toEqual([{ scopes: [graphScope] }]);
      expect(ranked).toHaveLength(1);
      expect(ranked[0]!.id).toBe("turn:1");
    });
  });

  describe("search text and ranking", () => {
    const baseScope = scope("run", "run-1");

    it("creates stable search text from nested metadata and ordering-independent objects", () => {
      const text = extractGraphSearchText({
        kind: "turn",
        nested: {
          beta: 2,
          alpha: 1,
        },
        list: ["one", { z: true, a: false }],
      });

      expect(text).toContain("alpha");
      expect(text).toContain("beta");
      expect(text).toContain("one");
      expect(text).toContain("true");
    });

    it("tokenizes search text by stripping punctuation and repeated whitespace", () => {
      expect(tokenizeGraphQuery("  Release/Deploy, Now!  ")).toEqual([
        "release",
        "deploy",
        "now",
      ]);
      expect(tokenizeGraphQuery("")).toEqual([]);
    });

    it("scores token overlap proportionally to matched tokens", () => {
      expect(scoreTokenOverlap(["release", "deploy"], "release deploy now")).toBe(1);
      expect(scoreTokenOverlap(["release", "deploy"], "release only")).toBe(0.5);
      expect(scoreTokenOverlap([], "release deploy")).toBe(0);
    });

    it("falls back to recency and kind boosting when no query tokens are present", () => {
      const recent = node("run:recent", {
        kind: "run",
        scope: baseScope,
        updatedAt: "2026-04-03T00:10:00.000Z",
      });
      const older = node("artifact:older", {
        kind: "artifact",
        scope: baseScope,
        updatedAt: "2026-04-02T00:10:00.000Z",
      });

      expect(scoreGraphNode(recent, "")).toBeGreaterThan(scoreGraphNode(older, ""));
    });

    it("weights title matches above summary and content matches", () => {
      const broadMatch = node("turn:broad", {
        scope: baseScope,
        title: "Deploy release",
        summary: "release planning",
        content: "unrelated content",
        kind: "turn",
      });
      const partialMatch = node("turn:partial", {
        scope: baseScope,
        title: "Deploy",
        summary: "planning only",
        content: "unrelated content",
        kind: "turn",
      });
      const contentMatch = node("turn:content", {
        scope: baseScope,
        title: "Housekeeping",
        summary: "keep it safe",
        content: "build now",
        kind: "turn",
      });

      expect(scoreGraphNode(broadMatch, "deploy release")).toBeGreaterThan(
        scoreGraphNode(partialMatch, "deploy release"),
      );
      expect(scoreGraphNode(contentMatch, "deploy release")).toBeGreaterThan(0);
      expect(scoreGraphNode(broadMatch, "deploy release")).toBeGreaterThan(
        scoreGraphNode(contentMatch, "deploy release"),
      );
    });

    it("builds graph node search text from the important node fields", () => {
      const record = node("task:deploy", {
        kind: "task",
        scope: scope("project", "capstan"),
        title: "Deploy task",
        status: "running",
        summary: "ship the release",
        content: "deploy release with guardrails",
        metadata: {
          owner: "infra",
          graphScopes: [scope("project", "capstan")],
        },
      });

      const text = graphNodeSearchText(record);
      expect(text).toContain("task deploy");
      expect(text).toContain("deploy task");
      expect(text).toContain("running");
      expect(text).toContain("ship the release");
      expect(text).toContain("guardrails");
      expect(text).toContain("project capstan");
    });

    it("sorts nodes and edges by descending timestamp and ascending id on ties", () => {
      const nodes = [
        node("b", { updatedAt: "2026-04-03T00:00:00.000Z" }),
        node("a", { updatedAt: "2026-04-03T00:00:00.000Z" }),
        node("c", { updatedAt: "2026-04-04T00:00:00.000Z" }),
      ];
      const edges = [
        edge("b", { updatedAt: "2026-04-03T00:00:00.000Z" }),
        edge("a", { updatedAt: "2026-04-03T00:00:00.000Z" }),
        edge("c", { updatedAt: "2026-04-04T00:00:00.000Z" }),
      ];

      expect(sortGraphNodes(nodes).map((entry) => entry.id)).toEqual(["c", "a", "b"]);
      expect(sortGraphEdges(edges).map((entry) => entry.id)).toEqual(["c", "a", "b"]);
      expect(compareTimestampDescendingThenId(nodes[0]!, nodes[1]!)).toBeGreaterThan(0);
    });
  });

  describe("context selection", () => {
    const scoped = scope("run", "run-1");
    const nodes = [
      node("run:1", {
        kind: "run",
        scope: scoped,
        title: "Run",
        status: "running",
        updatedAt: "2026-04-04T00:00:00.000Z",
      }),
      node("turn:1", {
        kind: "turn",
        scope: scoped,
        title: "Turn one",
        summary: "release",
        updatedAt: "2026-04-03T00:00:00.000Z",
      }),
      node("memory:1", {
        kind: "memory",
        scope: scoped,
        title: "Memory one",
        summary: "release note",
        updatedAt: "2026-04-02T00:00:00.000Z",
      }),
      node("artifact:1", {
        kind: "artifact",
        scope: scoped,
        title: "Artifact one",
        summary: "screenshot",
        updatedAt: "2026-04-01T00:00:00.000Z",
      }),
    ];

    it("selects the newest nodes when the query is empty", () => {
      const selected = selectGraphNodesForContext(nodes, {
        query: "",
        limit: 3,
      });

      expect(selected.map((entry) => entry.id)).toEqual(["run:1", "turn:1", "memory:1"]);
    });

    it("prefers query matches while keeping recency as a tie breaker", () => {
      const selected = selectGraphNodesForContext(nodes, {
        query: "release",
        limit: 3,
      });

      expect(selected[0]!.id).toBe("turn:1");
      expect(selected[1]!.id).toBe("memory:1");
      expect(selected.map((entry) => entry.id)).not.toContain("artifact:1");
    });

    it("respects the requested kinds filter before scoring", () => {
      const selected = selectGraphNodesForContext(nodes, {
        query: "release",
        limit: 10,
        kinds: ["memory", "artifact"],
      });

      expect(selected.map((entry) => entry.kind)).toEqual(["memory", "artifact"]);
    });

    it("builds a graph context block from the selected nodes and reverses them into narrative order", () => {
      const block = buildGraphContextBlock([nodes[2]!, nodes[0]!, nodes[1]!]);
      expect(block?.kind).toBe("graph");
      expect(block?.title).toBe("Graph State");
      expect(block?.content).toContain("[memory] Memory one summary=release note");
      expect(block?.content).toContain("[run] Run status=running");
      expect(block?.tokens).toBeGreaterThan(0);
      expect(buildGraphContextBlocks([])).toEqual([]);
      expect(buildGraphContextBlocks(nodes.slice(0, 2))).toHaveLength(1);
    });
  });

  describe("scope title and filter matrix", () => {
    const cases = [
      {
        name: "titles keep project identifiers visible after normalization",
        input: scope("project", "  capstan-core  "),
        expectedKey: "project__capstan-core",
        expectedTitle: "Project: capstan-core",
      },
      {
        name: "titles keep app identifiers visible after normalization",
        input: scope("app", "  ops-console  "),
        expectedKey: "app__ops-console",
        expectedTitle: "App: ops-console",
      },
      {
        name: "titles keep run identifiers visible after normalization",
        input: scope("run", "  run-42  "),
        expectedKey: "run__run-42",
        expectedTitle: "Run: run-42",
      },
      {
        name: "titles keep resource identifiers visible after normalization",
        input: {
          kind: "resource" as const,
          resourceType: "  workspace  ",
          resourceId: "  capstan/cloud  ",
        },
        expectedKey: "resource__workspace__capstan_cloud",
        expectedTitle: "Resource: workspace/capstan/cloud",
      },
      {
        name: "titles keep capability identifiers visible after normalization",
        input: scope("capability", "  planner-v2  "),
        expectedKey: "capability__planner-v2",
        expectedTitle: "Capability: planner-v2",
      },
      {
        name: "titles keep policy identifiers visible after normalization",
        input: scope("policy", "  stage-3c  "),
        expectedKey: "policy__stage-3c",
        expectedTitle: "Policy: stage-3c",
      },
      {
        name: "titles keep entity identifiers visible after normalization",
        input: {
          kind: "entity" as const,
          entityType: "  deployment  ",
          entityId: "  canary-1  ",
        },
        expectedKey: "entity__deployment__canary-1",
        expectedTitle: "Entity: deployment/canary-1",
      },
      {
        name: "mixed scope lists still dedupe with graphScopeKey ordering",
        input: [
          scope("run", "run-1"),
          scope("project", "capstan"),
          scope("run", "run-1"),
        ],
        expectedKeys: ["run__run-1", "project__capstan"],
      },
      {
        name: "graphScopesIntersect matches when any scope overlaps",
        left: [scope("run", "run-1"), scope("project", "capstan")],
        right: [scope("project", "capstan")],
        expected: true,
      },
      {
        name: "graphScopesIntersect rejects when scope sets are disjoint",
        left: [scope("run", "run-1"), scope("project", "capstan")],
        right: [scope("resource", "alpha")],
        expected: false,
      },
      {
        name: "graph node matching respects ids and run filters together",
        node: node("turn:scope-matrix", {
          kind: "turn",
          scope: scope("run", "run-1"),
          runId: "run-1",
          metadata: {
            graphScopes: [scope("project", "capstan")],
          },
        }),
        query: {
          kinds: ["turn"],
          ids: ["turn:scope-matrix"],
          runId: "run-1",
          scopes: [scope("project", "capstan")],
        },
        expected: true,
      },
      {
        name: "graph edge matching respects ids, endpoints, and run filters together",
        edge: edge("edge:scope-matrix", {
          kind: "references",
          from: "task:1",
          to: "artifact:1",
          scope: scope("run", "run-1"),
          runId: "run-1",
        }),
        query: {
          kinds: ["references"],
          ids: ["edge:scope-matrix"],
          fromIds: ["task:1"],
          toIds: ["artifact:1"],
          runId: "run-1",
          scopes: [scope("run", "run-1")],
        },
        expected: true,
      },
    ] as const;

    for (const testCase of cases) {
      it(testCase.name, () => {
        if ("input" in testCase && Array.isArray(testCase.input)) {
          expect(normalizeGraphScopes(testCase.input)).toEqual(
            testCase.expectedKeys.map((key) => {
              if (key.startsWith("run__")) return scope("run", "run-1");
              if (key.startsWith("project__")) return scope("project", "capstan");
              return scope("project", "capstan");
            }),
          );
          return;
        }
        if ("node" in testCase) {
          expect(graphNodeMatchesQuery(testCase.node, testCase.query)).toBe(testCase.expected);
          return;
        }
        if ("edge" in testCase) {
          expect(graphEdgeMatchesQuery(testCase.edge, testCase.query)).toBe(testCase.expected);
          return;
        }
        if ("left" in testCase) {
          expect(graphScopesIntersect(testCase.left, testCase.right)).toBe(testCase.expected);
          return;
        }
        const normalized = normalizeGraphScope(testCase.input);
        expect(graphScopeKey(testCase.input)).toBe(testCase.expectedKey);
        expect(formatHarnessGraphScopeTitle(normalized)).toBe(testCase.expectedTitle);
      });
    }
  });
});
