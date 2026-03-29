import type { CapabilityExecutionResult } from "../types.js";

export async function listBillingInvoices(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listBillingInvoices",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-billing-invoices.ts."
  };
}
