import type { CapabilityExecutionResult } from "../types.js";

export async function inviteUser(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "inviteUser",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/invite-user.ts."
  };
}
