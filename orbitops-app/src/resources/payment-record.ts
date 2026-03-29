import type { ResourceDefinition } from "../types.js";

export const paymentRecordResource = {
  "key": "paymentRecord",
  "title": "回款记录",
  "description": "针对发票的回款记录。",
  "fields": {
    "amountCents": {
      "type": "integer",
      "required": true,
      "description": "金额（分）"
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
  "relations": {
    "billingInvoice": {
      "resource": "billingInvoice",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
