import type {
  CapabilityDefinition
} from "../../types.js";

export const updateRenewalOpportunityCapability = {
  "key": "updateRenewalOpportunity",
  "title": "更新续费机会",
  "mode": "write",
  "input": {
    "currentMrrCents": {
      "type": "integer",
      "required": true,
      "description": "当前 MRR（分）"
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    },
    "proposedMrrCents": {
      "type": "integer",
      "required": true,
      "description": "建议 MRR（分）"
    },
    "renewalCampaignId": {
      "type": "string",
      "description": "Reference to one related renewalCampaign record."
    },
    "riskLevel": {
      "type": "string",
      "required": true,
      "description": "风险等级",
      "constraints": {
        "enum": [
          "high",
          "low",
          "medium"
        ]
      }
    },
    "serviceSubscriptionId": {
      "type": "string",
      "description": "Reference to one related serviceSubscription record."
    },
    "stage": {
      "type": "string",
      "required": true,
      "description": "阶段",
      "constraints": {
        "enum": [
          "engaged",
          "identified",
          "lost",
          "negotiating",
          "renewed"
        ]
      }
    }
  },
  "output": {
    "currentMrrCents": {
      "type": "integer",
      "required": true,
      "description": "当前 MRR（分）"
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one renewalOpportunity record."
    },
    "proposedMrrCents": {
      "type": "integer",
      "required": true,
      "description": "建议 MRR（分）"
    },
    "renewalCampaignId": {
      "type": "string",
      "description": "Reference to one related renewalCampaign record."
    },
    "riskLevel": {
      "type": "string",
      "required": true,
      "description": "风险等级",
      "constraints": {
        "enum": [
          "high",
          "low",
          "medium"
        ]
      }
    },
    "serviceSubscriptionId": {
      "type": "string",
      "description": "Reference to one related serviceSubscription record."
    },
    "stage": {
      "type": "string",
      "required": true,
      "description": "阶段",
      "constraints": {
        "enum": [
          "engaged",
          "identified",
          "lost",
          "negotiating",
          "renewed"
        ]
      }
    }
  },
  "resources": [
    "renewalOpportunity"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
