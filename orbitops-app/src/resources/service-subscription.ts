import type { ResourceDefinition } from "../types.js";

export const serviceSubscriptionResource = {
  "key": "serviceSubscription",
  "title": "服务订阅",
  "description": "客户的有效订阅，关联价格计划和来源订单。",
  "fields": {
    "currency": {
      "type": "string",
      "required": true,
      "description": "币种",
      "constraints": {
        "maxLength": 3
      }
    },
    "endDate": {
      "type": "date",
      "required": true,
      "description": "结束日期"
    },
    "mrrCents": {
      "type": "integer",
      "required": true,
      "description": "月经常性收入 MRR（分）"
    },
    "renewalDate": {
      "type": "date",
      "required": true,
      "description": "续费日期"
    },
    "startDate": {
      "type": "date",
      "required": true,
      "description": "开始日期"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "cancelled",
          "expired",
          "paused"
        ]
      }
    },
    "subscriptionNumber": {
      "type": "string",
      "required": true,
      "description": "订阅编号"
    }
  },
  "relations": {
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    },
    "invoices": {
      "resource": "billingInvoice",
      "kind": "many",
      "description": "关联发票"
    },
    "pricingPlan": {
      "resource": "pricingPlan",
      "kind": "one"
    },
    "salesOrder": {
      "resource": "salesOrder",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
