import type { ResourceDefinition } from "../types.js";

export const salesOrderResource = {
  "key": "salesOrder",
  "title": "销售订单",
  "description": "从合同或直接销售发起的订单。",
  "fields": {
    "currency": {
      "type": "string",
      "required": true,
      "description": "币种",
      "constraints": {
        "maxLength": 3
      }
    },
    "discountPercent": {
      "type": "number",
      "required": true,
      "description": "整单折扣百分比",
      "constraints": {
        "minimum": 0,
        "maximum": 100
      }
    },
    "orderDate": {
      "type": "date",
      "required": true,
      "description": "下单日期"
    },
    "orderNumber": {
      "type": "string",
      "required": true,
      "description": "订单编号"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "approved",
          "cancelled",
          "draft",
          "fulfilled",
          "submitted"
        ]
      }
    },
    "totalCents": {
      "type": "integer",
      "required": true,
      "description": "订单总额（分）"
    }
  },
  "relations": {
    "commercialContract": {
      "resource": "commercialContract",
      "kind": "one"
    },
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    },
    "lines": {
      "resource": "salesOrderLine",
      "kind": "many",
      "description": "订单行项"
    },
    "subscriptions": {
      "resource": "serviceSubscription",
      "kind": "many",
      "description": "关联订阅"
    }
  }
} satisfies ResourceDefinition;
