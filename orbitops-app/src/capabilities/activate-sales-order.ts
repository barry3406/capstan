import type { CapabilityExecutionResult } from "../types.js";

export async function activateSalesOrder(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { orderId } = input;

  if (!orderId) {
    return {
      capability: "activateSalesOrder",
      status: "failed",
      input,
      note: "Missing required field: orderId",
    };
  }

  const taskRef = `task-activate-${orderId}-${Date.now()}`;

  return {
    capability: "activateSalesOrder",
    status: "completed",
    input,
    output: {
      taskReference: taskRef,
      orderId,
      previousStatus: "draft",
      newStatus: "active",
      activatedAt: new Date().toISOString(),
    },
    note: "Durable activation task started.",
  };
}
