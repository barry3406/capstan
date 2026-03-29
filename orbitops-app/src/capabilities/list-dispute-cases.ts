import type { CapabilityExecutionResult } from "../types.js";

export async function listDisputeCases(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listDisputeCases",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-dispute-cases.ts."
  };
}
