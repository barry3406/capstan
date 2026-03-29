import type { CapabilityExecutionResult } from "../types.js";

export async function listMembers(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listMembers",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-members.ts."
  };
}
