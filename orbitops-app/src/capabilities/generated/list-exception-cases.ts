import type {
  CapabilityDefinition
} from "../../types.js";

export const listExceptionCasesCapability = {
  "key": "listExceptionCases",
  "title": "异常列表",
  "mode": "read",
  "output": {
    "billingInvoiceId": {
      "type": "string",
      "description": "Reference to one related billingInvoice record."
    },
    "category": {
      "type": "string",
      "required": true,
      "description": "异常类别",
      "constraints": {
        "enum": [
          "billing_mismatch",
          "data_quality",
          "other",
          "payment_failure",
          "sync_error"
        ]
      }
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one exceptionCase record."
    },
    "ownerId": {
      "type": "string",
      "required": true,
      "description": "负责人 ID"
    },
    "salesOrderId": {
      "type": "string",
      "description": "Reference to one related salesOrder record."
    },
    "serviceSubscriptionId": {
      "type": "string",
      "description": "Reference to one related serviceSubscription record."
    },
    "severity": {
      "type": "string",
      "required": true,
      "description": "严重程度",
      "constraints": {
        "enum": [
          "critical",
          "high",
          "low",
          "medium"
        ]
      }
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "awaiting_input",
          "closed",
          "investigating",
          "open",
          "resolved"
        ]
      }
    },
    "title": {
      "type": "string",
      "required": true,
      "description": "异常标题"
    }
  },
  "resources": [
    "exceptionCase"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
