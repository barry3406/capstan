import type { CapabilityExecutionResult } from "../types.js";

export async function listApprovalRequests(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listApprovalRequests",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-approval-requests.ts."
  };
}
