import type { PolicyDefinition } from "../types.js";

export const customerAccountApprovalRequiredPolicy = {
  "key": "customerAccountApprovalRequired",
  "title": "Customer Account Approval Required",
  "description": "Requires approval before review may continue for one customer account.",
  "effect": "approve"
} satisfies PolicyDefinition;
