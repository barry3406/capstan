import type {
  CapabilityDefinition
} from "../../types.js";

export const processRefundRequestCapability = {
  "key": "processRefundRequest",
  "title": "处理退款",
  "mode": "external",
  "input": {
    "refundRequestId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced record payload or reference for artifact \"refundExecutionReceipt\"."
    },
    "refundRequestId": {
      "type": "string",
      "description": "Stable identifier for the refundRequest record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"processRefundRequestTask\"."
    }
  },
  "resources": [
    "refundRequest"
  ],
  "task": "processRefundRequestTask",
  "policy": "refundRequestApprovalRequired"
} satisfies CapabilityDefinition;
