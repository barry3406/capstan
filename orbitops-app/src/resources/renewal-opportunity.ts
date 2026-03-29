import type { ResourceDefinition } from "../types.js";

export const renewalOpportunityResource = {
  "key": "renewalOpportunity",
  "title": "续费机会",
  "description": "续费活动中的单个续费机会。",
  "fields": {
    "currentMrrCents": {
      "type": "integer",
      "required": true,
      "description": "当前 MRR（分）"
    },
    "proposedMrrCents": {
      "type": "integer",
      "required": true,
      "description": "建议 MRR（分）"
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
  "relations": {
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    },
    "renewalCampaign": {
      "resource": "renewalCampaign",
      "kind": "one"
    },
    "serviceSubscription": {
      "resource": "serviceSubscription",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
