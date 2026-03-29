import type { CapabilityExecutionResult } from "../types.js";

export async function upsertServiceSubscription(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertServiceSubscription",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-service-subscription.ts."
  };
}
