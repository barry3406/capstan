import type { CapabilityExecutionResult } from "../types.js";

export async function upsertSyncJob(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertSyncJob",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-sync-job.ts."
  };
}
