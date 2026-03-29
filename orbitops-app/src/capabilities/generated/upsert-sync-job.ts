import type {
  CapabilityDefinition
} from "../../types.js";

export const upsertSyncJobCapability = {
  "key": "upsertSyncJob",
  "title": "创建同步任务",
  "mode": "write",
  "input": {
    "completedAt": {
      "type": "datetime",
      "required": true,
      "description": "完成时间"
    },
    "direction": {
      "type": "string",
      "required": true,
      "description": "方向",
      "constraints": {
        "enum": [
          "inbound",
          "outbound"
        ]
      }
    },
    "errorSummary": {
      "type": "string",
      "required": true,
      "description": "错误摘要"
    },
    "integrationConnectionId": {
      "type": "string",
      "description": "Reference to one related integrationConnection record."
    },
    "recordsFailed": {
      "type": "integer",
      "required": true,
      "description": "失败记录数"
    },
    "recordsProcessed": {
      "type": "integer",
      "required": true,
      "description": "已处理记录数"
    },
    "startedAt": {
      "type": "datetime",
      "required": true,
      "description": "开始时间"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "cancelled",
          "completed",
          "failed",
          "running"
        ]
      }
    }
  },
  "output": {
    "completedAt": {
      "type": "datetime",
      "required": true,
      "description": "完成时间"
    },
    "direction": {
      "type": "string",
      "required": true,
      "description": "方向",
      "constraints": {
        "enum": [
          "inbound",
          "outbound"
        ]
      }
    },
    "errorSummary": {
      "type": "string",
      "required": true,
      "description": "错误摘要"
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one syncJob record."
    },
    "integrationConnectionId": {
      "type": "string",
      "description": "Reference to one related integrationConnection record."
    },
    "recordsFailed": {
      "type": "integer",
      "required": true,
      "description": "失败记录数"
    },
    "recordsProcessed": {
      "type": "integer",
      "required": true,
      "description": "已处理记录数"
    },
    "startedAt": {
      "type": "datetime",
      "required": true,
      "description": "开始时间"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "cancelled",
          "completed",
          "failed",
          "running"
        ]
      }
    }
  },
  "resources": [
    "syncJob"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
