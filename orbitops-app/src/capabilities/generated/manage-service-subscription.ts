import type {
  CapabilityDefinition
} from "../../types.js";

export const manageServiceSubscriptionCapability = {
  "key": "manageServiceSubscription",
  "title": "管理订阅生命周期",
  "mode": "external",
  "input": {
    "serviceSubscriptionId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced record payload or reference for artifact \"subscriptionLifecycleRecord\"."
    },
    "serviceSubscriptionId": {
      "type": "string",
      "description": "Stable identifier for the serviceSubscription record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"manageServiceSubscriptionTask\"."
    }
  },
  "resources": [
    "serviceSubscription"
  ],
  "task": "manageServiceSubscriptionTask",
  "policy": "serviceSubscriptionApprovalRequired"
} satisfies CapabilityDefinition;
