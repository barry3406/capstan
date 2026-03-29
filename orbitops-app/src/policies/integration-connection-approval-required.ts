import type { PolicyDefinition } from "../types.js";

export const integrationConnectionApprovalRequiredPolicy = {
  "key": "integrationConnectionApprovalRequired",
  "title": "Integration Connection Approval Required",
  "description": "Requires approval before sync may continue for one integration connection.",
  "effect": "approve"
} satisfies PolicyDefinition;
