import type { PolicyDefinition } from "../types.js";

export const reconciliationCaseApprovalRequiredPolicy = {
  "key": "reconciliationCaseApprovalRequired",
  "title": "Reconciliation Case Approval Required",
  "description": "Requires approval before reconcile may continue for one reconciliation case.",
  "effect": "approve"
} satisfies PolicyDefinition;
