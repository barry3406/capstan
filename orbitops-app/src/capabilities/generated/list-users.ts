import type {
  CapabilityDefinition
} from "../../types.js";

export const listUsersCapability = {
  "key": "listUsers",
  "title": "List Users",
  "description": "Read the current users in the system.",
  "mode": "read",
  "resources": [
    "user"
  ],
  "policy": "authenticated"
} satisfies CapabilityDefinition;
