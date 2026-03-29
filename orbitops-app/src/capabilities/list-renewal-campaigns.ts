import type { CapabilityExecutionResult } from "../types.js";

export async function listRenewalCampaigns(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listRenewalCampaigns",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-renewal-campaigns.ts."
  };
}
