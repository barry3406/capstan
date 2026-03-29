import type { CapabilityExecutionResult } from "../types.js";

export async function upsertCustomerAccount(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertCustomerAccount",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-customer-account.ts."
  };
}
