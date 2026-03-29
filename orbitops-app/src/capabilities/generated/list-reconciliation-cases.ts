import type {
  CapabilityDefinition
} from "../../types.js";

export const listReconciliationCasesCapability = {
  "key": "listReconciliationCases",
  "title": "对账列表",
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
    "discrepancyCents": {
      "type": "integer",
      "required": true,
      "description": "差异金额（分）"
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one reconciliationCase record."
    },
    "periodEnd": {
      "type": "date",
      "required": true,
      "description": "对账期间结束"
    },
    "periodStart": {
      "type": "date",
      "required": true,
      "description": "对账期间开始"
    },
    "salesOrderId": {
      "type": "string",
      "description": "Reference to one related salesOrder record."
    },
    "serviceSubscriptionId": {
      "type": "string",
      "description": "Reference to one related serviceSubscription record."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "escalated",
          "in_progress",
          "open",
          "resolved"
        ]
      }
    },
    "title": {
      "type": "string",
      "required": true,
      "description": "案例标题"
    }
  },
  "resources": [
    "reconciliationCase"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
