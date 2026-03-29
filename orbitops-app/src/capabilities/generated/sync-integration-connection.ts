import type {
  CapabilityDefinition
} from "../../types.js";

export const syncIntegrationConnectionCapability = {
  "key": "syncIntegrationConnection",
  "title": "触发同步",
  "mode": "external",
  "input": {
    "integrationConnectionId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced report payload or reference for artifact \"syncHealthReport\"."
    },
    "integrationConnectionId": {
      "type": "string",
      "description": "Stable identifier for the integrationConnection record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"syncIntegrationConnectionTask\"."
    }
  },
  "resources": [
    "integrationConnection"
  ],
  "task": "syncIntegrationConnectionTask",
  "policy": "integrationConnectionApprovalRequired"
} satisfies CapabilityDefinition;
