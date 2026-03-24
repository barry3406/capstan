import type { AppGraph } from "../../../packages/app-graph/src/index.ts";

export const policyWorkflowAppGraph: AppGraph = {
  version: 1,
  domain: {
    key: "support",
    title: "Support Hub",
    description: "A richer graph used to exercise multi-action human workflows and policy-aware states."
  },
  resources: [
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
        },
        owner: {
          type: "string"
        }
      }
    }
  ],
  policies: [
    {
      key: "operatorAccess",
      title: "Operator Access",
      effect: "allow"
    },
    {
      key: "managerApproval",
      title: "Manager Approval",
      effect: "approve"
    },
    {
      key: "complianceBlock",
      title: "Compliance Block",
      effect: "deny"
    },
    {
      key: "redactExports",
      title: "Redact Exports",
      effect: "redact"
    }
  ],
  capabilities: [
    {
      key: "listTickets",
      title: "List Tickets",
      mode: "read",
      resources: ["ticket"],
      policy: "operatorAccess"
    },
    {
      key: "createTicket",
      title: "Create Ticket",
      mode: "write",
      resources: ["ticket"],
      policy: "operatorAccess",
      input: {
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
        },
        owner: {
          type: "string"
        }
      }
    },
    {
      key: "escalateTicket",
      title: "Escalate Ticket",
      mode: "write",
      resources: ["ticket"],
      policy: "managerApproval",
      input: {
        title: {
          type: "string",
          required: true
        }
      }
    },
    {
      key: "deleteTicket",
      title: "Delete Ticket",
      mode: "write",
      resources: ["ticket"],
      policy: "complianceBlock"
    },
    {
      key: "exportTicketDigest",
      title: "Export Ticket Digest",
      mode: "external",
      resources: ["ticket"],
      policy: "redactExports"
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
