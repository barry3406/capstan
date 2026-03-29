import type { CapabilityExecutionResult } from "../types.js";

export async function recordPaymentRecord(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "recordPaymentRecord",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/record-payment-record.ts."
  };
}
