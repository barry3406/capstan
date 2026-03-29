import type { CapabilityExecutionResult } from "../types.js";

export async function listAuditNotes(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listAuditNotes",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-audit-notes.ts."
  };
}
