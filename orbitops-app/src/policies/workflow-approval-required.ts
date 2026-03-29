import type { PolicyDefinition } from "../types.js";

export const workflowApprovalRequiredPolicy = {
  "key": "workflowApprovalRequired",
  "title": "Work Request Approval Required",
  "description": "Requires explicit approval before work request processing may continue.",
  "effect": "approve"
} satisfies PolicyDefinition;
