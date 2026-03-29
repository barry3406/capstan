import type { ResourceDefinition } from "../types.js";

export const refundRequestResource = {
  "key": "refundRequest",
  "title": "退款申请",
  "description": "关联发票或回款的退款申请。",
  "fields": {
    "amountCents": {
      "type": "integer",
      "required": true,
      "description": "退款金额（分）"
    },
    "currency": {
      "type": "string",
      "required": true,
      "description": "币种",
      "constraints": {
        "maxLength": 3
      }
    },
    "reason": {
      "type": "string",
      "required": true,
      "description": "退款原因"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "approved",
          "executed",
          "rejected",
          "requested"
        ]
      }
    }
  },
  "relations": {
    "billingInvoice": {
      "resource": "billingInvoice",
      "kind": "one"
    },
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    },
    "paymentRecord": {
      "resource": "paymentRecord",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
