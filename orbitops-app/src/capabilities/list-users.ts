import type { CapabilityExecutionResult } from "../types.js";

export async function listUsers(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listUsers",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-users.ts."
  };
}
