import type { ResourceDefinition } from "../types.js";

export const roleResource = {
  "key": "role",
  "title": "Role",
  "description": "An authorization role assignable to authenticated operators.",
  "fields": {
    "description": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "required": true
    }
  }
} satisfies ResourceDefinition;
