import type {
  CapabilityDefinition
} from "../../types.js";

export const addAuditNoteCapability = {
  "key": "addAuditNote",
  "title": "添加审计备注",
  "mode": "write",
  "input": {
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
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    }
  },
  "output": {
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
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one auditNote record."
    }
  },
  "resources": [
    "auditNote"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
