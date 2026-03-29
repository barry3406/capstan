import type {
  CapabilityDefinition
} from "../../types.js";

export const requestRefundRequestCapability = {
  "key": "requestRefundRequest",
  "title": "发起退款",
  "mode": "write",
  "input": {
    "amountCents": {
      "type": "integer",
      "required": true,
      "description": "退款金额（分）"
    },
    "billingInvoiceId": {
      "type": "string",
      "description": "Reference to one related billingInvoice record."
    },
    "currency": {
      "type": "string",
      "required": true,
      "description": "币种",
      "constraints": {
        "maxLength": 3
      }
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    },
    "paymentRecordId": {
      "type": "string",
      "description": "Reference to one related paymentRecord record."
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
  "output": {
    "amountCents": {
      "type": "integer",
      "required": true,
      "description": "退款金额（分）"
    },
    "billingInvoiceId": {
      "type": "string",
      "description": "Reference to one related billingInvoice record."
    },
    "currency": {
      "type": "string",
      "required": true,
      "description": "币种",
      "constraints": {
        "maxLength": 3
      }
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one refundRequest record."
    },
    "paymentRecordId": {
      "type": "string",
      "description": "Reference to one related paymentRecord record."
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
  "resources": [
    "refundRequest"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
