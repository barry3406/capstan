import type { ResourceDefinition } from "../types.js";

export const integrationConnectionResource = {
  "key": "integrationConnection",
  "title": "集成连接器",
  "description": "与外部系统（Salesforce、Stripe、NetSuite、HubSpot）的连接配置。",
  "fields": {
    "lastSyncedAt": {
      "type": "datetime",
      "required": true,
      "description": "上次同步时间"
    },
    "name": {
      "type": "string",
      "required": true,
      "description": "连接名称"
    },
    "provider": {
      "type": "string",
      "required": true,
      "description": "供应商",
      "constraints": {
        "enum": [
          "hubspot",
          "netsuite",
          "salesforce",
          "stripe"
        ]
      }
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "disconnected",
          "error",
          "paused"
        ]
      }
    }
  },
  "relations": {
    "syncJobs": {
      "resource": "syncJob",
      "kind": "many",
      "description": "关联同步任务"
    },
    "workspace": {
      "resource": "workspace",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
