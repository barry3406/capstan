import type { ViewDefinition } from "../../types.js";

export const billingInvoiceListView = {
  "key": "billingInvoiceList",
  "title": "账单发票列表",
  "kind": "list",
  "resource": "billingInvoice",
  "capability": "listBillingInvoices"
} satisfies ViewDefinition;
