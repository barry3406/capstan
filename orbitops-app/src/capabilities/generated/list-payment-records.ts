import type {
  CapabilityDefinition
} from "../../types.js";

export const listPaymentRecordsCapability = {
  "key": "listPaymentRecords",
  "title": "回款列表",
  "mode": "read",
  "output": {
    "amountCents": {
      "type": "integer",
      "required": true,
      "description": "金额（分）"
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
    "externalReference": {
      "type": "string",
      "required": true,
      "description": "外部参考号"
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one paymentRecord record."
    },
    "paymentMethod": {
      "type": "string",
      "required": true,
      "description": "支付方式",
      "constraints": {
        "enum": [
          "ach",
          "check",
          "credit_card",
          "other",
          "wire"
        ]
      }
    },
    "receivedAt": {
      "type": "datetime",
      "required": true,
      "description": "到账时间"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "confirmed",
          "failed",
          "pending",
          "reversed"
        ]
      }
    }
  },
  "resources": [
    "paymentRecord"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
