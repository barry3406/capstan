import type {
  CapabilityDefinition
} from "../../types.js";

export const listIntegrationConnectionsCapability = {
  "key": "listIntegrationConnections",
  "title": "连接器列表",
  "mode": "read",
  "output": {
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one integrationConnection record."
    },
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
    },
    "syncJobIds": {
      "type": "json",
      "description": "关联同步任务"
    },
    "workspaceId": {
      "type": "string",
      "description": "Reference to one related workspace record."
    }
  },
  "resources": [
    "integrationConnection"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
