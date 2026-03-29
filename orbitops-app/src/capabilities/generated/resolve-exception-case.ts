import type {
  CapabilityDefinition
} from "../../types.js";

export const resolveExceptionCaseCapability = {
  "key": "resolveExceptionCase",
  "title": "处理异常",
  "mode": "external",
  "input": {
    "exceptionCaseId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced report payload or reference for artifact \"exceptionResolutionSummary\"."
    },
    "exceptionCaseId": {
      "type": "string",
      "description": "Stable identifier for the exceptionCase record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"resolveExceptionCaseTask\"."
    }
  },
  "resources": [
    "exceptionCase"
  ],
  "task": "resolveExceptionCaseTask",
  "policy": "exceptionCaseApprovalRequired"
} satisfies CapabilityDefinition;
