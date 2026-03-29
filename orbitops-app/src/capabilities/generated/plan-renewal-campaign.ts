import type {
  CapabilityDefinition
} from "../../types.js";

export const planRenewalCampaignCapability = {
  "key": "planRenewalCampaign",
  "title": "规划续费活动",
  "mode": "write",
  "input": {
    "name": {
      "type": "string",
      "required": true,
      "description": "活动名称"
    },
    "opportunitieIds": {
      "type": "json",
      "description": "关联续费机会"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "closed",
          "draft"
        ]
      }
    },
    "windowEnd": {
      "type": "date",
      "required": true,
      "description": "窗口结束日期"
    },
    "windowStart": {
      "type": "date",
      "required": true,
      "description": "窗口开始日期"
    },
    "workspaceId": {
      "type": "string",
      "description": "Reference to one related workspace record."
    }
  },
  "output": {
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one renewalCampaign record."
    },
    "name": {
      "type": "string",
      "required": true,
      "description": "活动名称"
    },
    "opportunitieIds": {
      "type": "json",
      "description": "关联续费机会"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "closed",
          "draft"
        ]
      }
    },
    "windowEnd": {
      "type": "date",
      "required": true,
      "description": "窗口结束日期"
    },
    "windowStart": {
      "type": "date",
      "required": true,
      "description": "窗口开始日期"
    },
    "workspaceId": {
      "type": "string",
      "description": "Reference to one related workspace record."
    }
  },
  "resources": [
    "renewalCampaign"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
