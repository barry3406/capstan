import type { CapabilityExecutionResult } from "../types.js";

export async function upsertCustomerContact(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertCustomerContact",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-customer-contact.ts."
  };
}
