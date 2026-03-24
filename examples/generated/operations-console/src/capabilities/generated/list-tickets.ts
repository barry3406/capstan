import type {
  CapabilityDefinition
} from "../../types.js";

export const listTicketsCapability = {
  "key": "listTickets",
  "title": "List Tickets",
  "mode": "read",
  "resources": [
    "ticket"
  ]
} satisfies CapabilityDefinition;
