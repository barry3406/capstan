import type { PolicyDefinition } from "../types.js";

export const salesOrderApprovalRequiredPolicy = {
  "key": "salesOrderApprovalRequired",
  "title": "Sales Order Approval Required",
  "description": "Requires approval before activate may continue for one sales order.",
  "effect": "approve"
} satisfies PolicyDefinition;
