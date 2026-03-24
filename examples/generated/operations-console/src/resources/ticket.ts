import type { ResourceDefinition } from "../types.js";

export const ticketResource = {
  "key": "ticket",
  "title": "Ticket",
  "fields": {
    "status": {
      "type": "string",
      "required": true
    },
    "title": {
      "type": "string",
      "required": true
    }
  }
} satisfies ResourceDefinition;
