import type {
  CapabilityDefinition
} from "../../types.js";

export const launchRenewalCampaignCapability = {
  "key": "launchRenewalCampaign",
  "title": "启动续费活动",
  "mode": "external",
  "input": {
    "renewalCampaignId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced report payload or reference for artifact \"renewalRiskDigest\"."
    },
    "renewalCampaignId": {
      "type": "string",
      "description": "Stable identifier for the renewalCampaign record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"launchRenewalCampaignTask\"."
    }
  },
  "resources": [
    "renewalCampaign"
  ],
  "task": "launchRenewalCampaignTask",
  "policy": "renewalCampaignApprovalRequired"
} satisfies CapabilityDefinition;
