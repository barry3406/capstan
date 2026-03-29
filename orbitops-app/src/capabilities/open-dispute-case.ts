import type { CapabilityExecutionResult } from "../types.js";

export async function openDisputeCase(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "openDisputeCase",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/open-dispute-case.ts."
  };
}
