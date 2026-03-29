import type { ResourceDefinition } from "../types.js";

export const organizationResource = {
  "key": "organization",
  "title": "Organization",
  "description": "A tenant container that scopes work inside the application.",
  "fields": {
    "name": {
      "type": "string",
      "required": true
    },
    "slug": {
      "type": "string",
      "required": true
    },
    "status": {
      "type": "string",
      "required": true,
      "constraints": {
        "enum": [
          "active",
          "suspended"
        ]
      }
    }
  }
} satisfies ResourceDefinition;
