import type {
  CapabilityDefinition
} from "../../types.js";

export const upsertSalesOrderLineCapability = {
  "key": "upsertSalesOrderLine",
  "title": "创建/编辑订单行项",
  "mode": "write",
  "input": {
    "discountPercent": {
      "type": "number",
      "required": true,
      "description": "折扣百分比",
      "constraints": {
        "minimum": 0,
        "maximum": 100
      }
    },
    "lineTotalCents": {
      "type": "integer",
      "required": true,
      "description": "行合计（分）"
    },
    "pricingPlanId": {
      "type": "string",
      "description": "Reference to one related pricingPlan record."
    },
    "productCatalogItemId": {
      "type": "string",
      "description": "Reference to one related productCatalogItem record."
    },
    "productName": {
      "type": "string",
      "required": true,
      "description": "产品名称"
    },
    "quantity": {
      "type": "integer",
      "required": true,
      "description": "数量"
    },
    "salesOrderId": {
      "type": "string",
      "description": "Reference to one related salesOrder record."
    },
    "unitPriceCents": {
      "type": "integer",
      "required": true,
      "description": "单价（分）"
    }
  },
  "output": {
    "discountPercent": {
      "type": "number",
      "required": true,
      "description": "折扣百分比",
      "constraints": {
        "minimum": 0,
        "maximum": 100
      }
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one salesOrderLine record."
    },
    "lineTotalCents": {
      "type": "integer",
      "required": true,
      "description": "行合计（分）"
    },
    "pricingPlanId": {
      "type": "string",
      "description": "Reference to one related pricingPlan record."
    },
    "productCatalogItemId": {
      "type": "string",
      "description": "Reference to one related productCatalogItem record."
    },
    "productName": {
      "type": "string",
      "required": true,
      "description": "产品名称"
    },
    "quantity": {
      "type": "integer",
      "required": true,
      "description": "数量"
    },
    "salesOrderId": {
      "type": "string",
      "description": "Reference to one related salesOrder record."
    },
    "unitPriceCents": {
      "type": "integer",
      "required": true,
      "description": "单价（分）"
    }
  },
  "resources": [
    "salesOrderLine"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
