import type { PolicyDefinition } from "../types.js";

export const serviceSubscriptionApprovalRequiredPolicy = {
  "key": "serviceSubscriptionApprovalRequired",
  "title": "Service Subscription Approval Required",
  "description": "Requires approval before manage may continue for one service subscription.",
  "effect": "approve"
} satisfies PolicyDefinition;
