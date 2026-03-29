import type { ViewDefinition } from "../../types.js";

export const billingInvoiceDetailView = {
  "key": "billingInvoiceDetail",
  "title": "账单发票详情",
  "kind": "detail",
  "resource": "billingInvoice",
  "capability": "collectBillingInvoice"
} satisfies ViewDefinition;
