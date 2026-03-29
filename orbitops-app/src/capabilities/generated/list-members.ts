import type {
  CapabilityDefinition
} from "../../types.js";

export const listMembersCapability = {
  "key": "listMembers",
  "title": "成员列表",
  "mode": "read",
  "output": {
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
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one member record."
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
    },
    "workspaceId": {
      "type": "string",
      "description": "Reference to one related workspace record."
    }
  },
  "resources": [
    "member"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
