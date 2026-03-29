import type {
  CapabilityDefinition
} from "../../types.js";

export const resolveDisputeCaseCapability = {
  "key": "resolveDisputeCase",
  "title": "解决争议",
  "mode": "external",
  "input": {
    "disputeCaseId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced report payload or reference for artifact \"disputeResolutionReport\"."
    },
    "disputeCaseId": {
      "type": "string",
      "description": "Stable identifier for the disputeCase record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"resolveDisputeCaseTask\"."
    }
  },
  "resources": [
    "disputeCase"
  ],
  "task": "resolveDisputeCaseTask",
  "policy": "disputeCaseApprovalRequired"
} satisfies CapabilityDefinition;
