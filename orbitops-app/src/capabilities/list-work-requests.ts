import type { CapabilityExecutionResult } from "../types.js";

export async function listWorkRequests(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listWorkRequests",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-work-requests.ts."
  };
}
