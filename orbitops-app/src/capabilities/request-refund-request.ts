import type { CapabilityExecutionResult } from "../types.js";

export async function requestRefundRequest(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { refundId, invoiceId, amountCents, reason } = input;

  if (!refundId || !invoiceId || amountCents == null) {
    return {
      capability: "requestRefundRequest",
      status: "failed",
      input,
      note: "Missing required fields: refundId, invoiceId, and amountCents are required.",
    };
  }

  const amount = typeof amountCents === "number" ? amountCents : 0;

  if (amount > 500_000) {
    return {
      capability: "requestRefundRequest",
      status: "approval_required",
      input,
      output: {
        reason: "Refund amount exceeds $5,000 threshold",
        amountCents: amount,
        approvalPolicy: "high-value-refund",
      },
      note: `Refund of ${(amount / 100).toFixed(2)} USD requires manager approval.`,
    };
  }

  return {
    capability: "requestRefundRequest",
    status: "completed",
    input,
    output: {
      refundId,
      invoiceId,
      amountCents: amount,
      reason: reason ?? "customer_request",
      refundStatus: "pending",
      requestedAt: new Date().toISOString(),
    },
  };
}
