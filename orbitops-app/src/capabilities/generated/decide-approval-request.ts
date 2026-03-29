import type {
  CapabilityDefinition
} from "../../types.js";

export const decideApprovalRequestCapability = {
  "key": "decideApprovalRequest",
  "title": "处理审批",
  "mode": "external",
  "input": {
    "approvalRequestId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "approvalRequestId": {
      "type": "string",
      "description": "Stable identifier for the approvalRequest record associated with this execution."
    },
    "artifact": {
      "type": "json",
      "description": "Produced record payload or reference for artifact \"approvalDecisionRecord\"."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"decideApprovalRequestTask\"."
    }
  },
  "resources": [
    "approvalRequest"
  ],
  "task": "decideApprovalRequestTask",
  "policy": "approvalRequestApprovalRequired"
} satisfies CapabilityDefinition;
