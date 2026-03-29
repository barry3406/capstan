import type { TaskDefinition } from "../types.js";

export const collectBillingInvoiceTaskTask = {
  "key": "collectBillingInvoiceTask",
  "title": "Collect Billing Invoice Task",
  "description": "对逾期或未付发票进行催收。",
  "kind": "durable",
  "artifacts": [
    "invoiceCollectionReceipt"
  ]
} satisfies TaskDefinition;
