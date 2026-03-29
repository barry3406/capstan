import type { PolicyDefinition } from "../types.js";

export const refundRequestApprovalRequiredPolicy = {
  "key": "refundRequestApprovalRequired",
  "title": "Refund Request Approval Required",
  "description": "Requires approval before process may continue for one refund request.",
  "effect": "approve"
} satisfies PolicyDefinition;
