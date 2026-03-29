import type { CapabilityExecutionResult } from "../types.js";

export async function upsertMember(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertMember",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-member.ts."
  };
}
