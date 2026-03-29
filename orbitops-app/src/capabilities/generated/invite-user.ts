import type {
  CapabilityDefinition
} from "../../types.js";

export const inviteUserCapability = {
  "key": "inviteUser",
  "title": "Invite User",
  "description": "Invite a new user and assign an initial role.",
  "mode": "write",
  "input": {
    "email": {
      "type": "string",
      "required": true
    },
    "roleKey": {
      "type": "string",
      "required": true
    }
  },
  "resources": [
    "role",
    "user"
  ],
  "policy": "authenticated"
} satisfies CapabilityDefinition;
