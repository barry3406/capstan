import { describe, expect, it } from "vitest";
import type { AppGraph } from "../../packages/app-graph/src/index.ts";
import { normalizeAppGraph } from "../../packages/app-graph/src/index.ts";
import {
  projectAgentSurface,
  renderAgentManifestJson
} from "../../packages/surface-agent/src/index.ts";
import { agentSurfaceAppGraph } from "../fixtures/graphs/agent-surface-app-graph.ts";

describe("surface-agent", () => {
  it("projects capabilities, tasks, and artifacts into a stable agent manifest", () => {
    const projection = projectAgentSurface(normalizeAppGraph(agentSurfaceAppGraph));

    expect(projection.domain.key).toBe("support");
    expect(projection.summary).toEqual({
      capabilityCount: 2,
      taskCount: 1,
      artifactCount: 1
    });
    expect(projection.entrypoints).toContain("resource");
    expect(projection.entrypoints).toContain("search");
    expect(projection.entrypoints).toContain("listAttentionItems");
    expect(projection.entrypoints).toContain("listAttentionQueues");
    expect(projection.entrypoints).toContain("listArtifactRecords");
    expect(projection.transport.adapter).toBe("local");
    expect(projection.transport.projections).toEqual([
      {
        key: "local",
        protocol: "in_process",
        status: "active",
        entrypoint: "handleAgentSurfaceRequest",
        methods: ["call"]
      },
      {
        key: "http_rpc",
        protocol: "http",
        status: "preview",
        entrypoint: "/rpc",
        methods: ["GET", "POST"]
      },
      {
        key: "mcp",
        protocol: "mcp",
        status: "preview",
        entrypoint: "createAgentSurfaceMcpAdapter",
        methods: ["tools/list", "tools/call"]
      },
      {
        key: "a2a",
        protocol: "a2a",
        status: "preview",
        entrypoint: "createAgentSurfaceA2aAdapter",
        methods: ["agent/card", "message/send"]
      }
    ]);
    expect(projection.transport.auth.mode).toBe("hook_optional");
    expect(projection.transport.auth.effects).toContain("approve");
    expect(projection.transport.operations.map((entry) => entry.key)).toContain("manifest");
    expect(projection.transport.operations.map((entry) => entry.key)).toContain("resource");
    expect(projection.transport.operations.map((entry) => entry.key)).toContain(
      "listAttentionItems"
    );
    expect(projection.transport.operations.map((entry) => entry.key)).toContain(
      "listAttentionQueues"
    );
    expect(projection.transport.operations.map((entry) => entry.key)).toContain("executeAction");
    expect(projection.transport.operations.map((entry) => entry.key)).toContain("startTaskAction");
    expect(projection.transport.operations.map((entry) => entry.key)).toContain("startTask");
    expect(projection.transport.operations.map((entry) => entry.key)).toContain("getWorkflowRun");
    expect(projection.transport.operations.map((entry) => entry.key)).toContain(
      "listWorkflowRuns"
    );
    expect(projection.transport.operations.map((entry) => entry.key)).toContain(
      "advanceWorkflowRun"
    );
    expect(projection.semantics.taskRunStatuses).toContain("approval_required");
    expect(projection.semantics.taskStatuses).toContain("input_required");
    expect(projection.capabilities.map((entry) => entry.key)).toEqual([
      "generateDigest",
      "listTickets"
    ]);
    expect(projection.capabilities[0]).toMatchObject({
      key: "generateDigest",
      policy: "reviewRequired",
      inputSchema: {
        ticketId: {
          type: "string",
          required: true
        }
      },
      outputSchema: {
        status: {
          type: "string",
          required: true
        },
        taskRunId: {
          type: "string"
        },
        artifact: {
          type: "json"
        }
      }
    });
    expect(projection.capabilities[1]).toMatchObject({
      key: "listTickets",
      outputSchema: {
        id: {
          type: "string",
          required: true
        },
        title: {
          type: "string",
          required: true
        },
        status: {
          type: "string",
          required: true
        }
      }
    });
    expect(projection.resources[0]).toMatchObject({
      key: "ticket",
      fieldKeys: ["status", "title"],
      capabilityKeys: ["generateDigest", "listTickets"]
    });
    expect(projection.resources[0]?.routes.map((route) => route.key)).toEqual([
      "ticketList",
      "ticketDetail",
      "ticketForm"
    ]);
    expect(projection.resources[0]?.routes[0]).toMatchObject({
      key: "ticketList",
      capabilityKey: "listTickets",
      actions: [
        {
          key: "generateDigest",
          entry: false,
          execution: {
            operation: "executeAction",
            routeKey: "ticketList",
            actionKey: "generateDigest",
            inputSchema: {
              ticketId: {
                type: "string",
                required: true
              }
            },
            scope: {
              kind: "resource",
              resourceKey: "ticket"
            }
          },
          taskStart: {
            operation: "startTaskAction",
            routeKey: "ticketList",
            actionKey: "generateDigest",
            task: {
              key: "generateDigestTask",
              title: "Generate Ticket Digest",
              kind: "durable",
              artifactKeys: ["ticketDigest"]
            },
            inputSchema: {
              ticketId: {
                type: "string",
                required: true
              }
            },
            scope: {
              kind: "resource",
              resourceKey: "ticket"
            }
          },
          workflow: {
            kind: "starter_run_recipe",
            runtime: "harness",
            interface: "cli",
            routeKey: "ticketList",
            actionKey: "generateDigest",
            task: {
              key: "generateDigestTask",
              title: "Generate Ticket Digest",
              kind: "durable",
              artifactKeys: ["ticketDigest"]
            },
            inputSchema: {
              ticketId: {
                type: "string",
                required: true
              }
            },
            scope: {
              kind: "resource",
              resourceKey: "ticket"
            },
            inputEnvelope: {
              injectedRoute: {
                routeKey: "ticketList",
                actionKey: "generateDigest",
                path: "/resources/ticket/list",
                kind: "list",
                resourceKey: "ticket"
              }
            },
            start: {
              key: "start",
              command: "capstan",
              args: [
                "harness:start",
                "<app-dir>",
                "generateDigestTask",
                "--json",
                "--input",
                "<input-path>"
              ],
              placeholders: ["appDir", "inputPath"]
            },
            observe: [
              {
                key: "get",
                command: "capstan",
                args: ["harness:get", "<app-dir>", "<run-id>", "--json"],
                placeholders: ["appDir", "runId"]
              },
              {
                key: "summary",
                command: "capstan",
                args: ["harness:summary", "<app-dir>", "<run-id>", "--json"],
                placeholders: ["appDir", "runId"]
              },
              {
                key: "memory",
                command: "capstan",
                args: ["harness:memory", "<app-dir>", "<run-id>", "--json"],
                placeholders: ["appDir", "runId"]
              }
            ],
            controlPlane: {
              getRun: {
                operation: "getWorkflowRun"
              },
              listRuns: {
                operation: "listWorkflowRuns",
                defaultFilter: {
                  taskKey: "generateDigestTask",
                  routeKey: "ticketList",
                  actionKey: "generateDigest",
                  attentionOnly: true
                }
              },
              attention: {
                operation: "listAttentionItems",
                defaultFilter: {
                  taskKey: "generateDigestTask",
                  routeKey: "ticketList",
                  actionKey: "generateDigest"
                },
                queues: {
                  operation: "listAttentionQueues",
                  defaultFilter: {
                    taskKey: "generateDigestTask",
                    routeKey: "ticketList",
                    actionKey: "generateDigest"
                  },
                  statuses: [
                    "approval_required",
                    "input_required",
                    "blocked",
                    "failed",
                    "paused",
                    "cancelled"
                  ]
                }
              },
              advance: {
                operation: "advanceWorkflowRun",
                transitions: [
                  {
                    key: "approve",
                    inputSchema: {
                      ticketId: {
                        type: "string",
                        required: true
                      }
                    }
                  },
                  {
                    key: "provideInput",
                    inputSchema: {
                      ticketId: {
                        type: "string",
                        required: true
                      }
                    }
                  },
                  {
                    key: "retry",
                    inputSchema: {
                      ticketId: {
                        type: "string",
                        required: true
                      }
                    }
                  },
                  {
                    key: "cancel"
                  }
                ]
              }
            },
            recover: {
              nextActions: {
                running: "continue",
                paused: "resume",
                approval_required: "await_approval",
                input_required: "await_input",
                failed: "retry",
                blocked: "resolve_block",
                completed: "inspect_output",
                cancelled: "review_cancellation"
              },
              commands: [
                {
                  key: "pause",
                  command: "capstan",
                  args: ["harness:pause", "<app-dir>", "<run-id>", "--json"],
                  placeholders: ["appDir", "runId"]
                },
                {
                  key: "resume",
                  command: "capstan",
                  args: ["harness:resume", "<app-dir>", "<run-id>", "--json"],
                  placeholders: ["appDir", "runId"]
                },
                {
                  key: "approve",
                  command: "capstan",
                  args: ["harness:approve", "<app-dir>", "<run-id>", "--json"],
                  placeholders: ["appDir", "runId"]
                },
                {
                  key: "provideInput",
                  command: "capstan",
                  args: [
                    "harness:provide-input",
                    "<app-dir>",
                    "<run-id>",
                    "--input",
                    "<input-path>",
                    "--json"
                  ],
                  placeholders: ["appDir", "runId", "inputPath"]
                },
                {
                  key: "retry",
                  command: "capstan",
                  args: ["harness:retry", "<app-dir>", "<run-id>", "--json"],
                  placeholders: ["appDir", "runId"]
                }
              ]
            }
          }
        },
        {
          key: "listTickets",
          entry: true,
          execution: {
            operation: "executeAction",
            routeKey: "ticketList",
            actionKey: "listTickets",
            inputSchema: {},
            scope: {
              kind: "resource",
              resourceKey: "ticket"
            }
          }
        }
      ]
    });
    expect(projection.resources[0]?.relations).toEqual([]);
    expect(projection.tasks[0]).toMatchObject({
      key: "generateDigestTask",
      capabilityKeys: ["generateDigest"],
      artifactKeys: ["ticketDigest"]
    });
    expect(projection.artifacts[0]).toMatchObject({
      key: "ticketDigest",
      taskKeys: ["generateDigestTask"],
      capabilityKeys: ["generateDigest"]
    });
  });

  it("renders a machine-readable manifest payload", () => {
    const projection = projectAgentSurface(normalizeAppGraph(agentSurfaceAppGraph));
    const manifest = renderAgentManifestJson(projection);

    expect(manifest).toContain('"entrypoints"');
    expect(manifest).toContain('"auth"');
    expect(manifest).toContain('"http_rpc"');
    expect(manifest).toContain('"mcp"');
    expect(manifest).toContain('"a2a"');
    expect(manifest).toContain('"approval_required"');
    expect(manifest).toContain('"generateDigestTask"');
    expect(manifest).toContain('"ticketDigest"');
    expect(manifest).toContain('"inputSchema"');
    expect(manifest).toContain('"outputSchema"');
    expect(manifest).toContain('"resources"');
    expect(manifest).toContain('"routes"');
    expect(manifest).toContain('"resource"');
    expect(manifest).toContain('"listAttentionItems"');
    expect(manifest).toContain('"listAttentionQueues"');
    expect(manifest).toContain('"executeAction"');
    expect(manifest).toContain('"startTaskAction"');
    expect(manifest).toContain('"getWorkflowRun"');
    expect(manifest).toContain('"listWorkflowRuns"');
    expect(manifest).toContain('"advanceWorkflowRun"');
    expect(manifest).toContain('"execution"');
    expect(manifest).toContain('"taskStart"');
    expect(manifest).toContain('"workflow"');
    expect(manifest).toContain('"starter_run_recipe"');
    expect(manifest).toContain('"controlPlane"');
  });

  it("projects relation-aware resource routes into the agent manifest", () => {
    const graph: AppGraph = {
      version: 1,
      domain: {
        key: "crm",
        title: "CRM Workspace"
      },
      resources: [
        {
          key: "account",
          title: "Account",
          fields: {
            name: {
              type: "string",
              required: true
            }
          },
          relations: {
            primaryContact: {
              resource: "contact",
              kind: "one",
              description: "Primary contact for the account."
            },
            tickets: {
              resource: "ticket",
              kind: "many"
            }
          }
        },
        {
          key: "contact",
          title: "Contact",
          fields: {
            fullName: {
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
            }
          }
        }
      ],
      tasks: [
        {
          key: "reviewContactTask",
          title: "Review Contact Task",
          kind: "durable",
          artifacts: ["contactReview"]
        }
      ],
      artifacts: [
        {
          key: "contactReview",
          title: "Contact Review",
          kind: "report"
        }
      ],
      capabilities: [
        {
          key: "listAccounts",
          title: "List Accounts",
          mode: "read",
          resources: ["account"]
        },
        {
          key: "reviewContact",
          title: "Review Contact",
          mode: "external",
          resources: ["contact"],
          task: "reviewContactTask"
        },
        {
          key: "listTickets",
          title: "List Tickets",
          mode: "read",
          resources: ["ticket"]
        }
      ],
      views: []
    };

    const projection = projectAgentSurface(normalizeAppGraph(graph));
    const accountResource = projection.resources.find((resource) => resource.key === "account");

    expect(accountResource?.relations).toEqual([
      {
        key: "primaryContact",
        label: "Primary Contact",
        resourceKey: "contact",
        kind: "one",
        description: "Primary contact for the account.",
        route: {
          key: "accountPrimaryContactRelationDetail",
          title: "Account Primary Contact Detail",
          kind: "detail",
          path: "/resources/account/relations/primary-contact/detail",
          resourceKey: "contact",
          capabilityKey: "reviewContact",
          generated: true,
          sourceResourceKey: "account",
          sourceRelationKey: "primaryContact",
          actions: [
            {
              key: "reviewContact",
              title: "Review Contact",
              mode: "external",
              resourceKeys: ["contact"],
              task: "reviewContactTask",
              inputFieldKeys: [],
              outputFieldKeys: [],
              entry: true,
              execution: {
                operation: "executeAction",
                routeKey: "accountPrimaryContactRelationDetail",
                actionKey: "reviewContact",
                inputSchema: {},
                scope: {
                  kind: "relation",
                  resourceKey: "contact",
                  sourceResourceKey: "account",
                  sourceRelationKey: "primaryContact",
                  contextSchema: {
                    sourceRecordId: {
                      type: "string",
                      required: true,
                      description:
                        "Identifier for the Account record whose Primary Contact relation scopes this action."
                    }
                  }
                }
              },
              taskStart: {
                operation: "startTaskAction",
                routeKey: "accountPrimaryContactRelationDetail",
                actionKey: "reviewContact",
                task: {
                  key: "reviewContactTask",
                  title: "Review Contact Task",
                  kind: "durable",
                  artifactKeys: ["contactReview"]
                },
                inputSchema: {},
                scope: {
                  kind: "relation",
                  resourceKey: "contact",
                  sourceResourceKey: "account",
                  sourceRelationKey: "primaryContact",
                  contextSchema: {
                    sourceRecordId: {
                      type: "string",
                      required: true,
                      description:
                        "Identifier for the Account record whose Primary Contact relation scopes this action."
                    }
                  }
                }
              },
              workflow: {
                kind: "starter_run_recipe",
                runtime: "harness",
                interface: "cli",
                routeKey: "accountPrimaryContactRelationDetail",
                actionKey: "reviewContact",
                task: {
                  key: "reviewContactTask",
                  title: "Review Contact Task",
                  kind: "durable",
                  artifactKeys: ["contactReview"]
                },
                inputSchema: {},
                scope: {
                  kind: "relation",
                  resourceKey: "contact",
                  sourceResourceKey: "account",
                  sourceRelationKey: "primaryContact",
                  contextSchema: {
                    sourceRecordId: {
                      type: "string",
                      required: true,
                      description:
                        "Identifier for the Account record whose Primary Contact relation scopes this action."
                    }
                  }
                },
                inputEnvelope: {
                  injectedRoute: {
                    routeKey: "accountPrimaryContactRelationDetail",
                    actionKey: "reviewContact",
                    path: "/resources/account/relations/primary-contact/detail",
                    kind: "detail",
                    resourceKey: "contact",
                    sourceResourceKey: "account",
                    sourceRelationKey: "primaryContact"
                  },
                  relationContext: {
                    sourceResourceKey: "account",
                    sourceRelationKey: "primaryContact",
                    contextSchema: {
                      sourceRecordId: {
                        type: "string",
                        required: true,
                        description:
                          "Identifier for the Account record whose Primary Contact relation scopes this action."
                      }
                    }
                  }
                },
                start: {
                  key: "start",
                  command: "capstan",
                  args: [
                    "harness:start",
                    "<app-dir>",
                    "reviewContactTask",
                    "--json",
                    "--input",
                    "<input-path>"
                  ],
                  placeholders: ["appDir", "inputPath"]
                },
                observe: [
                  {
                    key: "get",
                    command: "capstan",
                    args: ["harness:get", "<app-dir>", "<run-id>", "--json"],
                    placeholders: ["appDir", "runId"]
                  },
                  {
                    key: "summary",
                    command: "capstan",
                    args: ["harness:summary", "<app-dir>", "<run-id>", "--json"],
                    placeholders: ["appDir", "runId"]
                  },
                  {
                    key: "memory",
                    command: "capstan",
                    args: ["harness:memory", "<app-dir>", "<run-id>", "--json"],
                    placeholders: ["appDir", "runId"]
                  }
                ],
                controlPlane: {
                  getRun: {
                    operation: "getWorkflowRun"
                  },
                  listRuns: {
                    operation: "listWorkflowRuns",
                    defaultFilter: {
                      taskKey: "reviewContactTask",
                      routeKey: "accountPrimaryContactRelationDetail",
                      actionKey: "reviewContact",
                      attentionOnly: true
                    }
                  },
                  attention: {
                    operation: "listAttentionItems",
                    defaultFilter: {
                      taskKey: "reviewContactTask",
                      routeKey: "accountPrimaryContactRelationDetail",
                      actionKey: "reviewContact"
                    },
                    queues: {
                      operation: "listAttentionQueues",
                      defaultFilter: {
                        taskKey: "reviewContactTask",
                        routeKey: "accountPrimaryContactRelationDetail",
                        actionKey: "reviewContact"
                      },
                      statuses: [
                        "approval_required",
                        "input_required",
                        "blocked",
                        "failed",
                        "paused",
                        "cancelled"
                      ]
                    }
                  },
                  advance: {
                    operation: "advanceWorkflowRun",
                    transitions: [
                      {
                        key: "approve",
                        inputSchema: {}
                      },
                      {
                        key: "provideInput",
                        inputSchema: {}
                      },
                      {
                        key: "retry",
                        inputSchema: {}
                      },
                      {
                        key: "cancel"
                      }
                    ]
                  }
                },
                recover: {
                  nextActions: {
                    running: "continue",
                    paused: "resume",
                    approval_required: "await_approval",
                    input_required: "await_input",
                    failed: "retry",
                    blocked: "resolve_block",
                    completed: "inspect_output",
                    cancelled: "review_cancellation"
                  },
                  commands: [
                    {
                      key: "pause",
                      command: "capstan",
                      args: ["harness:pause", "<app-dir>", "<run-id>", "--json"],
                      placeholders: ["appDir", "runId"]
                    },
                    {
                      key: "resume",
                      command: "capstan",
                      args: ["harness:resume", "<app-dir>", "<run-id>", "--json"],
                      placeholders: ["appDir", "runId"]
                    },
                    {
                      key: "approve",
                      command: "capstan",
                      args: ["harness:approve", "<app-dir>", "<run-id>", "--json"],
                      placeholders: ["appDir", "runId"]
                    },
                    {
                      key: "provideInput",
                      command: "capstan",
                      args: [
                        "harness:provide-input",
                        "<app-dir>",
                        "<run-id>",
                        "--input",
                        "<input-path>",
                        "--json"
                      ],
                      placeholders: ["appDir", "runId", "inputPath"]
                    },
                    {
                      key: "retry",
                      command: "capstan",
                      args: ["harness:retry", "<app-dir>", "<run-id>", "--json"],
                      placeholders: ["appDir", "runId"]
                    }
                  ]
                }
              }
            }
          ]
        },
        capabilityKeys: ["reviewContact"]
      },
      {
        key: "tickets",
        label: "Tickets",
        resourceKey: "ticket",
        kind: "many",
        route: {
          key: "accountTicketsRelationList",
          title: "Account Tickets List",
          kind: "list",
          path: "/resources/account/relations/tickets/list",
          resourceKey: "ticket",
          capabilityKey: "listTickets",
          generated: true,
          sourceResourceKey: "account",
          sourceRelationKey: "tickets",
          actions: [
            {
              key: "listTickets",
              title: "List Tickets",
              mode: "read",
              resourceKeys: ["ticket"],
              inputFieldKeys: [],
              outputFieldKeys: [],
              entry: true,
              execution: {
                operation: "executeAction",
                routeKey: "accountTicketsRelationList",
                actionKey: "listTickets",
                inputSchema: {},
                scope: {
                  kind: "relation",
                  resourceKey: "ticket",
                  sourceResourceKey: "account",
                  sourceRelationKey: "tickets",
                  contextSchema: {
                    sourceRecordId: {
                      type: "string",
                      required: true,
                      description:
                        "Identifier for the Account record whose Tickets relation scopes this action."
                    }
                  }
                }
              }
            }
          ]
        },
        capabilityKeys: ["listTickets"]
      }
    ]);
  });
});
