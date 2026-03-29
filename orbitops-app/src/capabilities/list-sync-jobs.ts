import type { CapabilityExecutionResult } from "../types.js";

export async function listSyncJobs(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listSyncJobs",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-sync-jobs.ts."
  };
}
