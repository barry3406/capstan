import type { CapabilityExecutionResult } from "../types.js";

export async function listMemberships(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listMemberships",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-memberships.ts."
  };
}
