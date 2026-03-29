import type { PolicyDefinition } from "../types.js";

export const billingInvoiceApprovalRequiredPolicy = {
  "key": "billingInvoiceApprovalRequired",
  "title": "Billing Invoice Approval Required",
  "description": "Requires approval before collect may continue for one billing invoice.",
  "effect": "approve"
} satisfies PolicyDefinition;
