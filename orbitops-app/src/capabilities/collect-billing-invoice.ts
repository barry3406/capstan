import type { CapabilityExecutionResult } from "../types.js";

export async function collectBillingInvoice(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { invoiceId, paymentMethod } = input;

  if (!invoiceId) {
    return {
      capability: "collectBillingInvoice",
      status: "failed",
      input,
      note: "Missing required field: invoiceId",
    };
  }

  const taskRef = `task-collect-${invoiceId}-${Date.now()}`;

  return {
    capability: "collectBillingInvoice",
    status: "completed",
    input,
    output: {
      taskReference: taskRef,
      invoiceId,
      paymentMethod: paymentMethod ?? "ach",
      collectionStatus: "processing",
      initiatedAt: new Date().toISOString(),
    },
    note: "Durable collection task started.",
  };
}
