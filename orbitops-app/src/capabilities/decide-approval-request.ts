import type { CapabilityExecutionResult } from "../types.js";

export async function decideApprovalRequest(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { approvalId, decision, decidedBy } = input;

  if (!approvalId) {
    return {
      capability: "decideApprovalRequest",
      status: "failed",
      input,
      note: "Missing required field: approvalId",
    };
  }

  const validDecisions = ["approved", "rejected", "deferred"];
  if (!decision || !validDecisions.includes(decision as string)) {
    return {
      capability: "decideApprovalRequest",
      status: "failed",
      input,
      note: `Invalid or missing decision. Must be one of: ${validDecisions.join(", ")}`,
    };
  }

  return {
    capability: "decideApprovalRequest",
    status: "completed",
    input,
    output: {
      approvalId,
      decision,
      decidedBy: decidedBy ?? "system",
      decidedAt: new Date().toISOString(),
    },
  };
}
