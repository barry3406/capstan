import type { CapabilityExecutionResult } from "../types.js";

export async function listReconciliationCases(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listReconciliationCases",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-reconciliation-cases.ts."
  };
}
