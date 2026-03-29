import type { CapabilityExecutionResult } from "../types.js";

export async function upsertWorkspace(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertWorkspace",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-workspace.ts."
  };
}
