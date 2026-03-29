import type { CapabilityExecutionResult } from "../types.js";

export async function processRefundRequest(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "processRefundRequest",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/process-refund-request.ts."
  };
}
