import type { CapabilityExecutionResult } from "../types.js";

export async function resolveExceptionCase(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { exceptionId, ownerId, resolution } = input;

  if (!exceptionId) {
    return {
      capability: "resolveExceptionCase",
      status: "failed",
      input,
      note: "Missing required field: exceptionId",
    };
  }

  if (!ownerId) {
    return {
      capability: "resolveExceptionCase",
      status: "input_required",
      input,
      output: {
        missingFields: ["ownerId"],
        message: "An owner must be assigned before resolving this exception case.",
      },
      note: "Cannot resolve exception case without an assigned owner.",
    };
  }

  return {
    capability: "resolveExceptionCase",
    status: "completed",
    input,
    output: {
      exceptionId,
      ownerId,
      resolution: resolution ?? "resolved",
      resolvedAt: new Date().toISOString(),
    },
  };
}
