import type { PolicyDefinition } from "../types.js";

export const renewalCampaignApprovalRequiredPolicy = {
  "key": "renewalCampaignApprovalRequired",
  "title": "Renewal Campaign Approval Required",
  "description": "Requires approval before launch may continue for one renewal campaign.",
  "effect": "approve"
} satisfies PolicyDefinition;
