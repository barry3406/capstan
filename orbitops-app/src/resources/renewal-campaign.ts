import type { ResourceDefinition } from "../types.js";

export const renewalCampaignResource = {
  "key": "renewalCampaign",
  "title": "续费活动",
  "description": "管理即将到期订阅续费的活动。",
  "fields": {
    "name": {
      "type": "string",
      "required": true,
      "description": "活动名称"
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
    }
  },
  "relations": {
    "opportunities": {
      "resource": "renewalOpportunity",
      "kind": "many",
      "description": "关联续费机会"
    },
    "workspace": {
      "resource": "workspace",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
