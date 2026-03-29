import type { PolicyDefinition } from "../types.js";

export const approvalRequestApprovalRequiredPolicy = {
  "key": "approvalRequestApprovalRequired",
  "title": "Approval Request Approval Required",
  "description": "Requires approval before decide may continue for one approval request.",
  "effect": "approve"
} satisfies PolicyDefinition;
