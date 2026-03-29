import type { ResourceDefinition } from "../types.js";

export const workspaceResource = {
  "key": "workspace",
  "title": "工作空间",
  "description": "租户下的工作空间，代表一条业务线、区域或运营团队。",
  "fields": {
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
  }
} satisfies ResourceDefinition;
