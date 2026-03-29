import type { CapabilityExecutionResult } from "../types.js";

export async function createSalesOrder(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const { orderNumber, orderDate, status, discountPercent } = input;

  const missing: string[] = [];
  if (!orderNumber) missing.push("orderNumber");
  if (!orderDate) missing.push("orderDate");
  if (!status) missing.push("status");

  if (missing.length > 0) {
    return {
      capability: "createSalesOrder",
      status: "failed",
      input,
      note: `Missing required fields: ${missing.join(", ")}`,
    };
  }

  const discount = typeof discountPercent === "number" ? discountPercent : 0;

  if (discount > 15) {
    return {
      capability: "createSalesOrder",
      status: "approval_required",
      input,
      output: {
        reason: "Discount exceeds 15% threshold",
        discountPercent: discount,
        approvalPolicy: "sales-discount-override",
      },
      note: `Discount of ${discount}% requires manager approval.`,
    };
  }

  const orderId = `so-${Date.now()}`;

  return {
    capability: "createSalesOrder",
    status: "completed",
    input,
    output: {
      orderId,
      orderNumber,
      orderDate,
      status,
      discountPercent: discount,
      createdAt: new Date().toISOString(),
    },
  };
}
