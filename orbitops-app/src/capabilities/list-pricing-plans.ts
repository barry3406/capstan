import type { CapabilityExecutionResult } from "../types.js";

export async function listPricingPlans(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listPricingPlans",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-pricing-plans.ts."
  };
}
