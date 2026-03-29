import type { CapabilityExecutionResult } from "../types.js";

export async function addAuditNote(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "addAuditNote",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/add-audit-note.ts."
  };
}
