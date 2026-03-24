import type {
  CapabilityDefinition,
  CapabilityExecutionResult
} from "../types.js";

export const listTicketsCapability = {
  "key": "listTickets",
  "title": "List Tickets",
  "mode": "read",
  "resources": [
    "ticket"
  ]
} satisfies CapabilityDefinition;

export async function listTickets(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: listTicketsCapability.key,
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-tickets.ts."
  };
}
