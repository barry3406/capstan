import type { ResourceDefinition } from "../types.js";

export const auditNoteResource = {
  "key": "auditNote",
  "title": "审计备注",
  "description": "可挂载到任何核心业务资源上的审计备注。",
  "fields": {
    "attachedToResourceId": {
      "type": "string",
      "required": true,
      "description": "挂载资源 ID"
    },
    "attachedToResourceKey": {
      "type": "string",
      "required": true,
      "description": "挂载资源类型"
    },
    "authorId": {
      "type": "string",
      "required": true,
      "description": "作者 ID"
    },
    "content": {
      "type": "string",
      "required": true,
      "description": "备注内容"
    },
    "createdAt": {
      "type": "datetime",
      "required": true,
      "description": "创建时间"
    }
  },
  "relations": {
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
