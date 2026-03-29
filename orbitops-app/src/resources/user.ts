import type { ResourceDefinition } from "../types.js";

export const userResource = {
  "key": "user",
  "title": "User",
  "description": "An authenticated user who can operate the application.",
  "fields": {
    "displayName": {
      "type": "string",
      "required": true
    },
    "email": {
      "type": "string",
      "required": true
    },
    "status": {
      "type": "string",
      "required": true,
      "constraints": {
        "enum": [
          "active",
          "disabled",
          "invited"
        ]
      }
    }
  }
} satisfies ResourceDefinition;
