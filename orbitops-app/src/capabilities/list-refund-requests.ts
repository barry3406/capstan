import type { CapabilityExecutionResult } from "../types.js";

export async function listRefundRequests(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listRefundRequests",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-refund-requests.ts."
  };
}
