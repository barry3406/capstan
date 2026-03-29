import type {
  CapabilityDefinition
} from "../../types.js";

export const submitWorkRequestCapability = {
  "key": "submitWorkRequest",
  "title": "Submit Work Request",
  "description": "Create and submit a new work request for review.",
  "mode": "write",
  "input": {
    "summary": {
      "type": "string"
    },
    "title": {
      "type": "string",
      "required": true
    }
  },
  "resources": [
    "workRequest"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
