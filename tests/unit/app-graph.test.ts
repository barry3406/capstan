import { describe, expect, it } from "vitest";
import type { AppGraph } from "../../packages/app-graph/src/index.ts";
import {
  CURRENT_APP_GRAPH_VERSION,
  diffAppGraphs,
  introspectAppGraph,
  inspectAppGraph,
  normalizeAppGraph,
  resolveAppGraphVersion,
  upgradeAppGraph,
  validateAppGraph
} from "../../packages/app-graph/src/index.ts";
import { basicAppGraph } from "../fixtures/graphs/basic-app-graph.ts";
import { packedOperationsAppGraph } from "../fixtures/graphs/packed-operations-app-graph.ts";

describe("app-graph", () => {
  it("accepts a valid graph", () => {
    const result = validateAppGraph(basicAppGraph);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("rejects duplicate keys and unknown references", () => {
    const graph: AppGraph = {
      ...basicAppGraph,
      resources: [
        basicAppGraph.resources[0]!,
        {
          key: "ticket",
          title: "Duplicate Ticket",
          fields: {
            code: {
              type: "string",
              required: true
            }
          }
        }
      ],
      capabilities: [
        {
          key: "listTickets",
          title: "List Tickets Again",
          mode: "read",
          resources: ["missing-resource"],
          task: "missing-task",
          policy: "missing-policy"
        }
      ],
      tasks: [
        {
          key: "syncTickets",
          title: "Sync Tickets",
          kind: "durable",
          artifacts: ["missing-artifact"]
        }
      ],
      views: [
        {
          key: "ticketList",
          title: "Ticket List",
          kind: "list",
          resource: "missing-resource",
          capability: "missing-capability"
        }
      ]
    };

    const result = validateAppGraph(graph);
    const messages = result.issues.map((issue) => `${issue.path}:${issue.message}`);

    expect(result.ok).toBe(false);
    expect(messages).toContain('resources.ticket:Duplicate key "ticket".');
    expect(messages).toContain(
      'capabilities.listTickets.resources:Unknown resource reference "missing-resource".'
    );
    expect(messages).toContain('capabilities.listTickets.task:Unknown task reference "missing-task".');
    expect(messages).toContain(
      'capabilities.listTickets.policy:Unknown policy reference "missing-policy".'
    );
    expect(messages).toContain(
      'tasks.syncTickets.artifacts:Unknown artifact reference "missing-artifact".'
    );
    expect(messages).toContain('views.ticketList.resource:Unknown resource reference "missing-resource".');
    expect(messages).toContain(
      'views.ticketList.capability:Unknown capability reference "missing-capability".'
    );
  });

  it("rejects empty graph structures that agents would not be able to operate", () => {
    const graph: AppGraph = {
      domain: {
        key: " ",
        title: " "
      },
      resources: [],
      capabilities: []
    };

    const result = validateAppGraph(graph);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "domain.key",
          message: "Domain key must not be empty."
        }),
        expect.objectContaining({
          path: "domain.title",
          message: "Domain title must not be empty."
        }),
        expect.objectContaining({
          path: "resources",
          message: "Graph must contain at least one resource."
        }),
        expect.objectContaining({
          path: "capabilities",
          message: "Graph must contain at least one capability."
        })
      ])
    );
  });

  it("normalizes graph ordering, versions, and empty collections", () => {
    const graph: AppGraph = {
      version: 1,
      domain: {
        key: " operations ",
        title: " Operations Console "
      },
      resources: [
        {
          key: "zTicket",
          title: " Z Ticket ",
          fields: {
            beta: {
              type: "string"
            },
            alpha: {
              type: "string"
            }
          }
        },
        {
          key: "aTicket",
          title: " A Ticket ",
          fields: {
            title: {
              type: "string",
              required: true
            }
          }
        }
      ],
      capabilities: [
        {
          key: "zAction",
          title: " Z Action ",
          mode: "read",
          resources: ["zTicket", "aTicket"]
        }
      ]
    };

    const normalized = normalizeAppGraph(graph);

    expect(normalized.version).toBe(CURRENT_APP_GRAPH_VERSION);
    expect(normalized.domain).toEqual({
      key: "operations",
      title: "Operations Console"
    });
    expect(normalized.resources.map((resource) => resource.key)).toEqual(["aTicket", "zTicket"]);
    expect(Object.keys(normalized.resources[1]?.fields ?? {})).toEqual(["alpha", "beta"]);
    expect(normalized.capabilities[0]?.resources).toEqual(["aTicket", "zTicket"]);
    expect(normalized.packs).toEqual([]);
    expect(normalized.tasks).toEqual([]);
    expect(normalized.policies).toEqual([]);
    expect(normalized.artifacts).toEqual([]);
    expect(normalized.views).toEqual([]);
  });

  it("produces a machine-readable summary for the graph", () => {
    const summary = inspectAppGraph(basicAppGraph);

    expect(summary).toEqual({
      version: 1,
      domain: basicAppGraph.domain,
      valid: true,
      issueCount: 0,
      counts: {
        packs: 0,
        resources: 1,
        capabilities: 1,
        tasks: 0,
        policies: 0,
        artifacts: 0,
        views: 1
      },
      keys: {
        packs: [],
        resources: ["ticket"],
        capabilities: ["listTickets"],
        tasks: [],
        policies: [],
        artifacts: [],
        views: ["ticketList"]
      }
    });
  });

  it("upgrades legacy graphs and exposes deterministic introspection metadata", () => {
    const legacyGraph: AppGraph = {
      domain: {
        key: " operations ",
        title: " Operations Console ",
        description: "Legacy graph"
      },
      resources: [
        {
          key: "ticket",
          title: "Ticket",
          fields: {
            status: {
              type: "string",
              required: true
            },
            title: {
              type: "string",
              required: true
            }
          }
        }
      ],
      capabilities: [
        {
          key: "listTickets",
          title: "List Tickets",
          mode: "read",
          resources: ["ticket"]
        }
      ],
      views: [
        {
          key: "ticketList",
          title: "Ticket List",
          kind: "list",
          resource: "ticket",
          capability: "listTickets"
        }
      ]
    };

    expect(resolveAppGraphVersion(legacyGraph)).toBe(0);
    expect(upgradeAppGraph(legacyGraph).version).toBe(CURRENT_APP_GRAPH_VERSION);

    const introspection = introspectAppGraph(legacyGraph);

    expect(introspection.metadata.sourceVersion).toBe(0);
    expect(introspection.metadata.normalizedVersion).toBe(1);
    expect(introspection.metadata.upgraded).toBe(true);
    expect(introspection.metadata.graphHash).toMatch(/^[0-9a-f]{8}$/);
    expect(introspection.validation.ok).toBe(true);
    expect(introspection.normalizedGraph).toMatchSnapshot();
  });

  it("preserves and normalizes declared pack selections", () => {
    const normalized = normalizeAppGraph(packedOperationsAppGraph);

    expect(normalized.packs).toEqual([
      {
        key: "tenant",
        options: {
          entityName: "Workspace",
          entityPlural: "Workspaces"
        }
      }
    ]);
  });

  it("rejects incompatible field constraints and unsupported future versions", () => {
    const invalidGraph: AppGraph = {
      ...basicAppGraph,
      version: CURRENT_APP_GRAPH_VERSION + 1,
      resources: [
        {
          key: "ticket",
          title: "Ticket",
          fields: {
            code: {
              type: "integer",
              constraints: {
                minLength: 3
              }
            },
            status: {
              type: "string",
              constraints: {
                pattern: "["
              }
            },
            title: {
              type: "string",
              required: true,
              constraints: {
                minLength: 5,
                maxLength: 3
              }
            }
          }
        }
      ],
      capabilities: [
        {
          key: "listTickets",
          title: "List Tickets",
          mode: "read",
          resources: ["ticket"],
          input: {
            priority: {
              type: "number",
              constraints: {
                minimum: 10,
                maximum: 1
              }
            }
          }
        }
      ]
    };

    const result = validateAppGraph(invalidGraph);
    const messages = result.issues.map((issue) => `${issue.path}:${issue.message}`);

    expect(result.ok).toBe(false);
    expect(messages).toContain(
      `version:Unsupported graph version "${CURRENT_APP_GRAPH_VERSION + 1}". Current version is "${CURRENT_APP_GRAPH_VERSION}".`
    );
    expect(messages).toContain(
      'resources.ticket.fields.code.constraints:String constraints require the field type to be "string".'
    );
    expect(messages).toContain(
      "resources.ticket.fields.status.constraints.pattern:Pattern must be a valid regular expression."
    );
    expect(messages).toContain(
      "resources.ticket.fields.title.constraints:minLength cannot be greater than maxLength."
    );
    expect(messages).toContain(
      "capabilities.listTickets.input.priority.constraints:minimum cannot be greater than maximum."
    );
  });

  it("diffs graph collections by added, removed, and changed keys", () => {
    const before = basicAppGraph;
    const after: AppGraph = {
      version: 1,
      domain: {
        key: "operations",
        title: "Operations Workspace"
      },
      resources: [
        {
          key: "customer",
          title: "Customer",
          fields: {
            name: {
              type: "string",
              required: true
            }
          }
        },
        {
          key: "ticket",
          title: "Ticket",
          fields: {
            title: {
              type: "string",
              required: true
            },
            status: {
              type: "string",
              required: true
            },
            priority: {
              type: "string"
            }
          }
        }
      ],
      capabilities: [
        {
          key: "getCustomer",
          title: "Get Customer",
          mode: "read",
          resources: ["customer"]
        },
        {
          key: "listTickets",
          title: "Browse Tickets",
          mode: "read",
          resources: ["ticket"]
        }
      ],
      views: [
        {
          key: "ticketList",
          title: "Ticket Queue",
          kind: "list",
          resource: "ticket",
          capability: "listTickets"
        }
      ]
    };

    const diff = diffAppGraphs(before, after);

    expect(diff.domainChanged).toBe(true);
    expect(diff.packs).toEqual({
      added: [],
      removed: [],
      changed: [],
      unchanged: []
    });
    expect(diff.resources).toEqual({
      added: ["customer"],
      removed: [],
      changed: ["ticket"],
      unchanged: []
    });
    expect(diff.capabilities).toEqual({
      added: ["getCustomer"],
      removed: [],
      changed: ["listTickets"],
      unchanged: []
    });
    expect(diff.views).toEqual({
      added: [],
      removed: [],
      changed: ["ticketList"],
      unchanged: []
    });
  });
});
