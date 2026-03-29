import type { CapabilityExecutionResult } from "../types.js";

export async function issueBillingInvoice(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { invoiceId, customerId, amountCents } = input;

  if (!invoiceId || !customerId || amountCents == null) {
    return {
      capability: "issueBillingInvoice",
      status: "failed",
      input,
      note: "Missing required fields: invoiceId, customerId, and amountCents are required.",
    };
  }

  const amount = typeof amountCents === "number" ? amountCents : 0;

  if (amount > 2_000_000) {
    return {
      capability: "issueBillingInvoice",
      status: "approval_required",
      input,
      output: {
        reason: "Invoice amount exceeds $20,000 threshold",
        amountCents: amount,
        approvalPolicy: "high-value-invoice",
      },
      note: `Invoice of ${(amount / 100).toFixed(2)} USD requires finance approval.`,
    };
  }

  return {
    capability: "issueBillingInvoice",
    status: "completed",
    input,
    output: {
      invoiceId,
      customerId,
      amountCents: amount,
      issuedAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      invoiceStatus: "issued",
    },
  };
}
