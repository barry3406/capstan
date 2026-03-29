import type {
  CapabilityDefinition
} from "../../types.js";

export const listSalesOrdersCapability = {
  "key": "listSalesOrders",
  "title": "订单列表",
  "mode": "read",
  "output": {
    "commercialContractId": {
      "type": "string",
      "description": "Reference to one related commercialContract record."
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
    "discountPercent": {
      "type": "number",
      "required": true,
      "description": "整单折扣百分比",
      "constraints": {
        "minimum": 0,
        "maximum": 100
      }
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one salesOrder record."
    },
    "lineIds": {
      "type": "json",
      "description": "订单行项"
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
    "subscriptionIds": {
      "type": "json",
      "description": "关联订阅"
    },
    "totalCents": {
      "type": "integer",
      "required": true,
      "description": "订单总额（分）"
    }
  },
  "resources": [
    "salesOrder"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
