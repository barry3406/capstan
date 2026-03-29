import type { CapabilityExecutionResult } from "../types.js";

export async function submitApprovalRequest(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "submitApprovalRequest",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/submit-approval-request.ts."
  };
}
