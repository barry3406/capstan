import type { ViewDefinition } from "../types.js";

import { ticketListView } from "./generated/ticket-list.js";

export const views: readonly ViewDefinition[] = [
  ticketListView
];
