import type { CapabilityExecutionResult } from "../types.js";

export async function reviewCustomerAccount(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "reviewCustomerAccount",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/review-customer-account.ts."
  };
}
