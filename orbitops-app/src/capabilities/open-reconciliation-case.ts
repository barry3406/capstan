import type { CapabilityExecutionResult } from "../types.js";

export async function openReconciliationCase(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "openReconciliationCase",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/open-reconciliation-case.ts."
  };
}
