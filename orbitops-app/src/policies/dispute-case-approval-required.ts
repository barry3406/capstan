import type { PolicyDefinition } from "../types.js";

export const disputeCaseApprovalRequiredPolicy = {
  "key": "disputeCaseApprovalRequired",
  "title": "Dispute Case Approval Required",
  "description": "Requires approval before resolve may continue for one dispute case.",
  "effect": "approve"
} satisfies PolicyDefinition;
