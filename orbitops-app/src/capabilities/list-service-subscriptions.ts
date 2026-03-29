import type { CapabilityExecutionResult } from "../types.js";

export async function listServiceSubscriptions(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listServiceSubscriptions",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-service-subscriptions.ts."
  };
}
