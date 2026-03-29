import type { CapabilityExecutionResult } from "../types.js";

export async function listPaymentRecords(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listPaymentRecords",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-payment-records.ts."
  };
}
