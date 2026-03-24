import type { AppGraph } from "../../../packages/app-graph/src/index.ts";

export const agentSurfaceAppGraph: AppGraph = {
  version: 1,
  domain: {
    key: "support",
    title: "Support Intelligence",
    description: "A graph used to exercise the first agent-facing control-plane loop."
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
        }
      }
    }
  ],
  tasks: [
    {
      key: "generateDigestTask",
      title: "Generate Ticket Digest",
      kind: "durable",
      artifacts: ["ticketDigest"]
    }
  ],
  artifacts: [
    {
      key: "ticketDigest",
      title: "Ticket Digest",
      kind: "report"
    }
  ],
  policies: [
    {
      key: "reviewRequired",
      title: "Review Required",
      effect: "approve"
    }
  ],
  capabilities: [
    {
      key: "generateDigest",
      title: "Generate Digest",
      mode: "external",
      input: {
        ticketId: {
          type: "string",
          required: true
        }
      },
      output: {
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
      },
      resources: ["ticket"],
      task: "generateDigestTask",
      policy: "reviewRequired"
    },
    {
      key: "listTickets",
      title: "List Tickets",
      mode: "read",
      output: {
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
      },
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
