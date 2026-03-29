import type { ResourceDefinition } from "../types.js";

export const exceptionCaseResource = {
  "key": "exceptionCase",
  "title": "异常案例",
  "description": "需要调查和处理的收入运营异常。",
  "fields": {
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
    "ownerId": {
      "type": "string",
      "required": true,
      "description": "负责人 ID"
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
