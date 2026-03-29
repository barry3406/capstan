import type { TaskDefinition } from "../types.js";

export const launchRenewalCampaignTaskTask = {
  "key": "launchRenewalCampaignTask",
  "title": "Launch Renewal Campaign Task",
  "description": "从符合条件的订阅中批量生成续费机会。",
  "kind": "durable",
  "artifacts": [
    "renewalRiskDigest"
  ]
} satisfies TaskDefinition;
