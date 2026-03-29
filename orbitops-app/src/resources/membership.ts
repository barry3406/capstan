import type { ResourceDefinition } from "../types.js";

export const membershipResource = {
  "key": "membership",
  "title": "Organization Membership",
  "description": "A link between one user and one organization.",
  "fields": {
    "organizationId": {
      "type": "string",
      "required": true
    },
    "roleKey": {
      "type": "string",
      "required": true
    },
    "userId": {
      "type": "string",
      "required": true
    }
  }
} satisfies ResourceDefinition;
