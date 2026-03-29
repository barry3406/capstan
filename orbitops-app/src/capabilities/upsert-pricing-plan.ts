import type { CapabilityExecutionResult } from "../types.js";

export async function upsertPricingPlan(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertPricingPlan",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-pricing-plan.ts."
  };
}
