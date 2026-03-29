import type { ResourceDefinition } from "../types.js";

export const workRequestResource = {
  "key": "workRequest",
  "title": "Work Request",
  "description": "A durable workflow request that can be reviewed and completed over time.",
  "fields": {
    "requestedById": {
      "type": "string",
      "required": true
    },
    "status": {
      "type": "string",
      "required": true,
      "constraints": {
        "enum": [
          "blocked",
          "completed",
          "draft",
          "in_review",
          "submitted"
        ]
      }
    },
    "summary": {
      "type": "string"
    },
    "title": {
      "type": "string",
      "required": true
    }
  }
} satisfies ResourceDefinition;
