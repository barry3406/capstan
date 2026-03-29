import type { PolicyDefinition } from "../types.js";

export const exceptionCaseApprovalRequiredPolicy = {
  "key": "exceptionCaseApprovalRequired",
  "title": "Exception Case Approval Required",
  "description": "Requires approval before resolve may continue for one exception case.",
  "effect": "approve"
} satisfies PolicyDefinition;
