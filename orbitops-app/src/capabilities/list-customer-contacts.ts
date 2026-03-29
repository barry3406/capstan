import type { CapabilityExecutionResult } from "../types.js";

export async function listCustomerContacts(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listCustomerContacts",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-customer-contacts.ts."
  };
}
