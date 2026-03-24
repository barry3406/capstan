import type { ViewDefinition } from "../../types.js";

export const ticketListView = {
  "key": "ticketList",
  "title": "Ticket List",
  "kind": "list",
  "resource": "ticket",
  "capability": "listTickets"
} satisfies ViewDefinition;
