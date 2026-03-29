import type { ResourceDefinition } from "../types.js";

export const syncJobResource = {
  "key": "syncJob",
  "title": "同步任务",
  "description": "集成连接器的单次同步执行记录。",
  "fields": {
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
  "relations": {
    "integrationConnection": {
      "resource": "integrationConnection",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
