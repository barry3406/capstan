import type {
  CapabilityDefinition
} from "../../types.js";

export const activateSalesOrderCapability = {
  "key": "activateSalesOrder",
  "title": "激活订单",
  "mode": "external",
  "input": {
    "salesOrderId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced record payload or reference for artifact \"salesOrderActivationReceipt\"."
    },
    "salesOrderId": {
      "type": "string",
      "description": "Stable identifier for the salesOrder record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"activateSalesOrderTask\"."
    }
  },
  "resources": [
    "salesOrder"
  ],
  "task": "activateSalesOrderTask",
  "policy": "salesOrderApprovalRequired"
} satisfies CapabilityDefinition;
