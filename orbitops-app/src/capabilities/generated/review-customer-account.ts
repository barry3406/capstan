import type {
  CapabilityDefinition
} from "../../types.js";

export const reviewCustomerAccountCapability = {
  "key": "reviewCustomerAccount",
  "title": "审查客户健康状况",
  "mode": "external",
  "input": {
    "customerAccountId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced report payload or reference for artifact \"customerHealthSnapshot\"."
    },
    "customerAccountId": {
      "type": "string",
      "description": "Stable identifier for the customerAccount record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"reviewCustomerAccountTask\"."
    }
  },
  "resources": [
    "customerAccount"
  ],
  "task": "reviewCustomerAccountTask",
  "policy": "customerAccountApprovalRequired"
} satisfies CapabilityDefinition;
