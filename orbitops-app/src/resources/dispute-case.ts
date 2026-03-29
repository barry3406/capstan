import type { ResourceDefinition } from "../types.js";

export const disputeCaseResource = {
  "key": "disputeCase",
  "title": "争议案例",
  "description": "客户发起或代客户发起的账单/支付争议。",
  "fields": {
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
  "relations": {
    "billingInvoice": {
      "resource": "billingInvoice",
      "kind": "one"
    },
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    },
    "salesOrder": {
      "resource": "salesOrder",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
