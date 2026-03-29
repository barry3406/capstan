import type { CapabilityExecutionResult } from "../types.js";

export async function processWorkRequest(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "processWorkRequest",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/process-work-request.ts."
  };
}
