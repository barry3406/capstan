import type { ViewDefinition } from "../../types.js";

export const billingInvoiceFormView = {
  "key": "billingInvoiceForm",
  "title": "开具账单发票",
  "kind": "form",
  "resource": "billingInvoice",
  "capability": "issueBillingInvoice"
} satisfies ViewDefinition;
