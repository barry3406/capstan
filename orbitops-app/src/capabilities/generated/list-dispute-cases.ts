import type {
  CapabilityDefinition
} from "../../types.js";

export const listDisputeCasesCapability = {
  "key": "listDisputeCases",
  "title": "争议列表",
  "mode": "read",
  "output": {
    "billingInvoiceId": {
      "type": "string",
      "description": "Reference to one related billingInvoice record."
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    },
    "description": {
      "type": "string",
      "required": true,
      "description": "争议描述"
    },
    "disputedAmountCents": {
      "type": "integer",
      "required": true,
      "description": "争议金额（分）"
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one disputeCase record."
    },
    "salesOrderId": {
      "type": "string",
      "description": "Reference to one related salesOrder record."
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
          "escalated",
          "investigating",
          "open",
          "resolved"
        ]
      }
    },
    "title": {
      "type": "string",
      "required": true,
      "description": "争议标题"
    }
  },
  "resources": [
    "disputeCase"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
