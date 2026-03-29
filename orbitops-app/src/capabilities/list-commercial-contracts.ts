import type { CapabilityExecutionResult } from "../types.js";

export async function listCommercialContracts(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listCommercialContracts",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-commercial-contracts.ts."
  };
}
