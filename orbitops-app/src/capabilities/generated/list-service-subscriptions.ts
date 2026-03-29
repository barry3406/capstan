import type {
  CapabilityDefinition
} from "../../types.js";

export const listServiceSubscriptionsCapability = {
  "key": "listServiceSubscriptions",
  "title": "订阅列表",
  "mode": "read",
  "output": {
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
    "endDate": {
      "type": "date",
      "required": true,
      "description": "结束日期"
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one serviceSubscription record."
    },
    "invoiceIds": {
      "type": "json",
      "description": "关联发票"
    },
    "mrrCents": {
      "type": "integer",
      "required": true,
      "description": "月经常性收入 MRR（分）"
    },
    "pricingPlanId": {
      "type": "string",
      "description": "Reference to one related pricingPlan record."
    },
    "renewalDate": {
      "type": "date",
      "required": true,
      "description": "续费日期"
    },
    "salesOrderId": {
      "type": "string",
      "description": "Reference to one related salesOrder record."
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
  "resources": [
    "serviceSubscription"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
