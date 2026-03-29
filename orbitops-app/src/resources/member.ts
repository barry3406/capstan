import type { ResourceDefinition } from "../types.js";

export const memberResource = {
  "key": "member",
  "title": "成员",
  "description": "工作空间中的用户成员及其角色。",
  "fields": {
    "displayName": {
      "type": "string",
      "required": true,
      "description": "显示名称"
    },
    "email": {
      "type": "string",
      "required": true,
      "description": "邮箱"
    },
    "roleKey": {
      "type": "string",
      "required": true,
      "description": "角色标识",
      "constraints": {
        "enum": [
          "approver",
          "csm",
          "financeOps",
          "revOps",
          "salesOps",
          "supportAuditor",
          "tenantAdmin"
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
          "deactivated",
          "suspended"
        ]
      }
    }
  },
  "relations": {
    "workspace": {
      "resource": "workspace",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
