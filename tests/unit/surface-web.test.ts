import { describe, expect, it } from "vitest";
import type { AppGraph } from "../../packages/app-graph/src/index.ts";
import { normalizeAppGraph } from "../../packages/app-graph/src/index.ts";
import {
  projectHumanSurface,
  renderHumanSurfaceDocument
} from "../../packages/surface-web/src/index.ts";
import { agentSurfaceAppGraph } from "../fixtures/graphs/agent-surface-app-graph.ts";
import { basicAppGraph } from "../fixtures/graphs/basic-app-graph.ts";

describe("surface-web", () => {
  it("projects workspace and resource routes from graph semantics", () => {
    const projection = projectHumanSurface(normalizeAppGraph(basicAppGraph));

    expect(
      projection.routes.map((route) => ({
        key: route.key,
        path: route.path,
        kind: route.kind,
        actionCount: route.actions.length
      }))
    ).toMatchSnapshot();

    expect(projection.navigation.map((item) => item.label)).toEqual([
      "Workspace",
      "Ticket Detail",
      "Ticket Form",
      "Ticket List"
    ]);
  });

  it("renders a human-facing document with projected routes and actions", () => {
    const projection = projectHumanSurface(normalizeAppGraph(basicAppGraph));
    const html = renderHumanSurfaceDocument(projection);

    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("Operations Console Workspace");
    expect(html).toContain("/resources/ticket/list");
    expect(html).toContain("/resources/ticket/detail");
    expect(html).toContain("/resources/ticket/form");
    expect(html).toContain("Capability Actions");
    expect(html).toContain("Operator Console");
    expect(html).toContain("data-route-nav=\"ticketList\"");
    expect(html).toContain("data-route-mode=\"loading\"");
    expect(html).toContain("data-action-key=\"listTickets\"");
    expect(html).toContain("data-route-table-body=\"ticketList\"");
    expect(html).toContain("data-route-detail-value-route=\"ticketDetail\"");
    expect(html).toContain("data-route-result-output=\"ticketForm\"");
    expect(html).toContain("data-route-result-state=\"idle\"");
    expect(html).toContain("mountHumanSurfaceBrowser(document)");
    expect(html).toContain("./dist/human-surface/index.js");
    expect(html).toContain("List Tickets");
  });

  it("prefers capability schemas over raw resource fields for projected route fields", () => {
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
            },
            tier: {
              type: "string"
            }
          }
        }
      ],
      capabilities: [
        {
          key: "listAccounts",
          title: "List Accounts",
          mode: "read",
          resources: ["account"],
          output: {
            id: {
              type: "string",
              required: true
            },
            primaryContactId: {
              type: "string"
            }
          }
        },
        {
          key: "upsertAccount",
          title: "Upsert Account",
          mode: "write",
          resources: ["account"],
          input: {
            name: {
              type: "string",
              required: true
            },
            primaryContactId: {
              type: "string",
              description: "Reference to one contact record."
            }
          },
          output: {
            id: {
              type: "string",
              required: true
            },
            name: {
              type: "string",
              required: true
            }
          }
        },
        {
          key: "reviewAccount",
          title: "Review Account",
          mode: "external",
          resources: ["account"],
          output: {
            status: {
              type: "string",
              required: true
            },
            taskRunId: {
              type: "string"
            }
          }
        }
      ],
      views: [
        {
          key: "accountList",
          title: "Account List",
          kind: "list",
          resource: "account",
          capability: "listAccounts"
        },
        {
          key: "accountForm",
          title: "Account Form",
          kind: "form",
          resource: "account",
          capability: "upsertAccount"
        },
        {
          key: "accountDetail",
          title: "Account Detail",
          kind: "detail",
          resource: "account",
          capability: "reviewAccount"
        }
      ]
    };

    const projection = projectHumanSurface(normalizeAppGraph(graph));
    const listRoute = projection.routes.find((route) => route.key === "accountList");
    const formRoute = projection.routes.find((route) => route.key === "accountForm");
    const detailRoute = projection.routes.find((route) => route.key === "accountDetail");

    expect(listRoute?.capabilityKey).toBe("listAccounts");
    expect(listRoute?.fields.map((field) => field.key)).toEqual(["id", "primaryContactId"]);
    expect(formRoute?.capabilityKey).toBe("upsertAccount");
    expect(formRoute?.fields.map((field) => field.key)).toEqual(["name", "primaryContactId"]);
    expect(detailRoute?.capabilityKey).toBe("reviewAccount");
    expect(detailRoute?.fields.map((field) => field.key)).toEqual(["status", "taskRunId"]);
  });

  it("projects related-record links from resource relations", () => {
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
              kind: "many",
              description: "Open tickets linked to this account."
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
      capabilities: [
        {
          key: "listAccounts",
          title: "List Accounts",
          mode: "read",
          resources: ["account"]
        },
        {
          key: "listContacts",
          title: "List Contacts",
          mode: "read",
          resources: ["contact"]
        },
        {
          key: "reviewContact",
          title: "Review Contact",
          mode: "external",
          resources: ["contact"],
          output: {
            fullName: {
              type: "string",
              required: true
            },
            relationshipState: {
              type: "string"
            }
          }
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

    const projection = projectHumanSurface(normalizeAppGraph(graph));
    const accountDetail = projection.routes.find((route) => route.key === "accountDetail");
    const primaryContactRelationRoute = projection.routes.find(
      (route) => route.key === "accountPrimaryContactRelationDetail"
    );
    const html = renderHumanSurfaceDocument(projection);

    expect(accountDetail?.relations).toEqual([
      {
        key: "primaryContact",
        label: "Primary Contact",
        resourceKey: "contact",
        kind: "one",
        routeKey: "accountPrimaryContactRelationDetail",
        routeTitle: "Account Primary Contact Detail",
        path: "/resources/account/relations/primary-contact/detail",
        description: "Primary contact for the account."
      },
      {
        key: "tickets",
        label: "Tickets",
        resourceKey: "ticket",
        kind: "many",
        routeKey: "accountTicketsRelationList",
        routeTitle: "Account Tickets List",
        path: "/resources/account/relations/tickets/list",
        description: "Open tickets linked to this account."
      }
    ]);
    expect(primaryContactRelationRoute).toMatchObject({
      key: "accountPrimaryContactRelationDetail",
      path: "/resources/account/relations/primary-contact/detail",
      title: "Account Primary Contact Detail",
      kind: "detail",
      resourceKey: "contact",
      capabilityKey: "reviewContact",
      sourceResourceKey: "account",
      sourceRelationKey: "primaryContact"
    });
    expect(primaryContactRelationRoute?.fields.map((field) => field.key)).toEqual([
      "fullName",
      "relationshipState"
    ]);
    expect(projection.navigation.map((item) => item.routeKey)).not.toContain(
      "accountPrimaryContactRelationDetail"
    );
    expect(html).toContain("Related Records");
    expect(html).toContain("Primary Contact");
    expect(html).toContain("Open Account Primary Contact Detail");
    expect(html).toContain("Open Account Tickets List");
    expect(html).toContain('data-related-path="/resources/account/relations/primary-contact/detail"');
    expect(html).toContain('data-related-path="/resources/account/relations/tickets/list"');
    expect(html).toContain("relation:account.primaryContact");
  });

  it("projects durable route attention queues for operator supervision", () => {
    const projection = projectHumanSurface(normalizeAppGraph(agentSurfaceAppGraph));
    const ticketList = projection.routes.find((route) => route.key === "ticketList");
    const html = renderHumanSurfaceDocument(projection);

    expect(ticketList?.attentionQueues.map((queue) => ({
      status: queue.status,
      actionKey: queue.actionKey,
      taskKey: queue.taskKey,
      filter: queue.filter
    }))).toEqual([
      {
        status: "approval_required",
        actionKey: "generateDigest",
        taskKey: "generateDigestTask",
        filter: {
          taskKey: "generateDigestTask",
          routeKey: "ticketList",
          actionKey: "generateDigest",
          status: "approval_required"
        }
      },
      {
        status: "input_required",
        actionKey: "generateDigest",
        taskKey: "generateDigestTask",
        filter: {
          taskKey: "generateDigestTask",
          routeKey: "ticketList",
          actionKey: "generateDigest",
          status: "input_required"
        }
      },
      {
        status: "blocked",
        actionKey: "generateDigest",
        taskKey: "generateDigestTask",
        filter: {
          taskKey: "generateDigestTask",
          routeKey: "ticketList",
          actionKey: "generateDigest",
          status: "blocked"
        }
      },
      {
        status: "failed",
        actionKey: "generateDigest",
        taskKey: "generateDigestTask",
        filter: {
          taskKey: "generateDigestTask",
          routeKey: "ticketList",
          actionKey: "generateDigest",
          status: "failed"
        }
      },
      {
        status: "paused",
        actionKey: "generateDigest",
        taskKey: "generateDigestTask",
        filter: {
          taskKey: "generateDigestTask",
          routeKey: "ticketList",
          actionKey: "generateDigest",
          status: "paused"
        }
      },
      {
        status: "cancelled",
        actionKey: "generateDigest",
        taskKey: "generateDigestTask",
        filter: {
          taskKey: "generateDigestTask",
          routeKey: "ticketList",
          actionKey: "generateDigest",
          status: "cancelled"
        }
      }
    ]);
    expect(html).toContain("Attention Queues");
    expect(html).toContain("workflow:generateDigestTask");
    expect(html).toContain("Open Approval Required Queue");
    expect(html).toContain('data-attention-route-key="ticketList"');
    expect(html).toContain('data-attention-action-key="generateDigest"');
    expect(html).toContain('data-attention-status="approval_required"');
    expect(html).toContain('data-route-attention-output="ticketList"');
  });

  it("projects a top-level human attention inbox for durable workflows", () => {
    const projection = projectHumanSurface(normalizeAppGraph(agentSurfaceAppGraph));
    const html = renderHumanSurfaceDocument(projection);

    expect(projection.attention.inbox).toEqual({
      key: "workflowAttentionInbox",
      label: "Open Attention Inbox"
    });
    expect(projection.attention.queues).toEqual([
      {
        key: "workflowAttentionQueue:approval_required",
        label: "Approval Required",
        status: "approval_required"
      },
      {
        key: "workflowAttentionQueue:input_required",
        label: "Input Required",
        status: "input_required"
      },
      {
        key: "workflowAttentionQueue:blocked",
        label: "Blocked",
        status: "blocked"
      },
      {
        key: "workflowAttentionQueue:failed",
        label: "Failed",
        status: "failed"
      },
      {
        key: "workflowAttentionQueue:paused",
        label: "Paused",
        status: "paused"
      },
      {
        key: "workflowAttentionQueue:cancelled",
        label: "Cancelled",
        status: "cancelled"
      }
    ]);
    expect(projection.attention.presets.map((preset) => preset.key)).toEqual([
      "task:generateDigestTask",
      "resource:ticket",
      "route:ticketDetail",
      "route:ticketForm",
      "route:ticketList"
    ]);
    expect(projection.attention.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "task:generateDigestTask",
          label: "Generate Ticket Digest",
          scope: "task",
          autoSlotKey: "primary",
          filter: {
            taskKey: "generateDigestTask"
          }
        }),
        expect.objectContaining({
          key: "resource:ticket",
          label: "Ticket",
          scope: "resource",
          autoSlotKey: "secondary",
          filter: {
            resourceKey: "ticket"
          }
        }),
        expect.objectContaining({
          key: "route:ticketDetail",
          label: "Ticket Detail",
          scope: "route",
          autoSlotKey: "watchlist",
          filter: {
            routeKey: "ticketDetail"
          }
        }),
        expect.objectContaining({
          key: "route:ticketForm",
          label: "Ticket Form",
          scope: "route",
          autoSlotKey: "watchlist",
          filter: {
            routeKey: "ticketForm"
          }
        }),
        expect.objectContaining({
          key: "route:ticketList",
          label: "Ticket Queue",
          scope: "route",
          autoSlotKey: "watchlist",
          filter: {
            routeKey: "ticketList"
          }
        })
      ])
    );
    expect(html).toContain("Attention Inbox");
    expect(html).toContain("Open Attention Inbox");
    expect(html).toContain("Task Attention Presets");
    expect(html).toContain("Resource Attention Presets");
    expect(html).toContain("Route Attention Presets");
    expect(html).toContain("Supervision Workspace");
    expect(html).toContain('data-console-attention-inbox="workflowAttentionInbox"');
    expect(html).toContain('data-console-attention-queue="approval_required"');
    expect(html).toContain('data-console-attention-preset-inbox="task:generateDigestTask"');
    expect(html).toContain('data-console-attention-preset-queue="resource:ticket"');
    expect(html).toContain('data-console-attention-preset-inbox="route:ticketList"');
    expect(html).toContain('data-console-attention-preset-queue="route:ticketList"');
    expect(html).toContain('data-console-attention-preset-auto-slot="primary"');
    expect(html).toContain('data-console-attention-preset-auto-slot="secondary"');
    expect(html).toContain('data-console-attention-preset-auto-slot="watchlist"');
    expect(html).toContain('data-console-supervision-refresh');
    expect(html).toContain('data-console-supervision-inbox');
    expect(html).toContain('data-console-supervision-clear-active');
    expect(html).toContain('data-console-supervision-clear-history');
    expect(html).toContain('data-console-supervision-slot-summary-count');
    expect(html).toContain('data-console-supervision-slot-summaries');
    expect(html).toContain('data-console-supervision-slot-summary-open="primary"');
    expect(html).toContain('data-console-supervision-slot-summary-queue="watchlist"');
    expect(html).toContain('data-console-supervision-slot-count');
    expect(html).toContain('data-console-supervision-slots');
    expect(html).toContain('data-console-supervision-slot-open="primary"');
    expect(html).toContain('data-console-supervision-slot-save="secondary"');
    expect(html).toContain('data-console-supervision-slot-clear="watchlist"');
    expect(html).toContain('data-console-supervision-queue-status="approval_required"');
    expect(html).toContain('data-console-supervision-trail');
    expect(html).toContain('data-console-supervision-copy');
    expect(html).toContain('data-console-supervision-history-count');
    expect(html).toContain('data-console-supervision-history');
    expect(html).toContain("Workspace Slots");
    expect(html).toContain("Slot Attention Summary");
    expect(html).toContain("Primary");
    expect(html).toContain("Watchlist");
    expect(html).toContain("Task Auto Slot");
    expect(html).toContain("Resource Auto Slot");
    expect(html).toContain("Route Auto Slot");
    expect(html).toContain("Waiting For Save");
    expect(html).toContain("new-since-open delta");
    expect(html).toContain("Open Slot Summary");
    expect(html).toContain("Open Priority Queue");
    expect(html).toContain("Opening this preset auto-saves it into the Primary slot unless you manually replace that slot.");
    expect(html).toContain('data-console-attention-preset-status="blocked"');
    expect(html).toContain('data-route-attention-handoff="ticketList"');
    expect(html).toContain('data-route-attention-handoff-controls="ticketList"');
    expect(html).toContain('data-route-attention-handoff-copy="ticketList"');
    expect(html).toContain("No Console Handoff");
    expect(html).toContain("No Pinned Workspace");
    expect(html).toContain("No Saved Workspaces");
    expect(html).toContain('data-console-attention-output');
  });
});
