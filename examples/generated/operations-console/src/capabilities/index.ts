import type {
  CapabilityDefinition,
  CapabilityExecutionResult
} from "../types.js";

import { listTicketsCapability } from "./generated/list-tickets.js";
import { listTickets } from "./list-tickets.js";

export const capabilities: readonly CapabilityDefinition[] = [
  listTicketsCapability
] as const;

export const capabilityHandlers: Record<
  string,
  (input: Record<string, unknown>) => Promise<CapabilityExecutionResult>
> = {
  "listTickets": listTickets
};
