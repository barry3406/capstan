import type { AppGraph } from "../../../packages/app-graph/src/index.ts";

export const basicAppGraph: AppGraph = {
  version: 1,
  domain: {
    key: "operations",
    title: "Operations Console",
    description: "A simple example graph used to validate the first Capstan loop."
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
