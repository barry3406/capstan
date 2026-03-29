import type { CapabilityExecutionResult } from "../types.js";

export async function listWorkspaces(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listWorkspaces",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-workspaces.ts."
  };
}
