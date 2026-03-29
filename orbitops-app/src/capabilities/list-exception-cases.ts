import type { CapabilityExecutionResult } from "../types.js";

export async function listExceptionCases(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listExceptionCases",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-exception-cases.ts."
  };
}
