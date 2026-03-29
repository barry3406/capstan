import type {
  CapabilityDefinition
} from "../../types.js";

export const processWorkRequestCapability = {
  "key": "processWorkRequest",
  "title": "Process Work Request",
  "description": "Advance one work request through a durable review workflow.",
  "mode": "external",
  "input": {
    "workRequestId": {
      "type": "string",
      "required": true
    }
  },
  "resources": [
    "workRequest"
  ],
  "task": "processWorkRequestTask",
  "policy": "workflowApprovalRequired"
} satisfies CapabilityDefinition;
