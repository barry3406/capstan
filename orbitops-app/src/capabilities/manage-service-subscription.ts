import type { CapabilityExecutionResult } from "../types.js";

export async function manageServiceSubscription(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { subscriptionId, action } = input;

  if (!subscriptionId) {
    return {
      capability: "manageServiceSubscription",
      status: "failed",
      input,
      note: "Missing required field: subscriptionId",
    };
  }

  const validActions = ["pause", "resume", "cancel"];
  if (!action || !validActions.includes(action as string)) {
    return {
      capability: "manageServiceSubscription",
      status: "failed",
      input,
      note: `Invalid or missing action. Must be one of: ${validActions.join(", ")}`,
    };
  }

  const statusMap: Record<string, string> = {
    pause: "paused",
    resume: "active",
    cancel: "cancelled",
  };

  return {
    capability: "manageServiceSubscription",
    status: "completed",
    input,
    output: {
      subscriptionId,
      action,
      previousStatus: "active",
      newStatus: statusMap[action as string],
      updatedAt: new Date().toISOString(),
    },
  };
}
