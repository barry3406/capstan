import type { ResourceDefinition } from "../types.js";

export const reconciliationCaseResource = {
  "key": "reconciliationCase",
  "title": "对账案例",
  "description": "跨订单、订阅、发票、回款的收入对账案例。",
  "fields": {
    "discrepancyCents": {
      "type": "integer",
      "required": true,
      "description": "差异金额（分）"
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
    },
    "serviceSubscription": {
      "resource": "serviceSubscription",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
