import type { CapabilityExecutionResult } from "../types.js";

export async function submitWorkRequest(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "submitWorkRequest",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/submit-work-request.ts."
  };
}
