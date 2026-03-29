import type {
  CapabilityDefinition
} from "../../types.js";

export const configureIntegrationConnectionCapability = {
  "key": "configureIntegrationConnection",
  "title": "配置连接器",
  "mode": "write",
  "input": {
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
