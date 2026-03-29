import type {
  CapabilityDefinition
} from "../../types.js";

export const listWorkspacesCapability = {
  "key": "listWorkspaces",
  "title": "工作空间列表",
  "mode": "read",
  "output": {
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one workspace record."
    },
    "name": {
      "type": "string",
      "required": true,
      "description": "工作空间名称"
    },
    "region": {
      "type": "string",
      "required": true,
      "description": "所属区域"
    },
    "slug": {
      "type": "string",
      "required": true,
      "description": "URL 标识符"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "archived",
          "suspended"
        ]
      }
    }
  },
  "resources": [
    "workspace"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
