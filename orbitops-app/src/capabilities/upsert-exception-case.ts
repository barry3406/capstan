import type { CapabilityExecutionResult } from "../types.js";

export async function upsertExceptionCase(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertExceptionCase",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-exception-case.ts."
  };
}
