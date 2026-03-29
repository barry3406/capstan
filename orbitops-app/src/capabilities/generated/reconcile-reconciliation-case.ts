import type {
  CapabilityDefinition
} from "../../types.js";

export const reconcileReconciliationCaseCapability = {
  "key": "reconcileReconciliationCase",
  "title": "执行对账",
  "mode": "external",
  "input": {
    "reconciliationCaseId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced report payload or reference for artifact \"revenueReconciliationCaseReport\"."
    },
    "reconciliationCaseId": {
      "type": "string",
      "description": "Stable identifier for the reconciliationCase record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"reconcileReconciliationCaseTask\"."
    }
  },
  "resources": [
    "reconciliationCase"
  ],
  "task": "reconcileReconciliationCaseTask",
  "policy": "reconciliationCaseApprovalRequired"
} satisfies CapabilityDefinition;
