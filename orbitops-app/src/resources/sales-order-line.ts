import type { ResourceDefinition } from "../types.js";

export const salesOrderLineResource = {
  "key": "salesOrderLine",
  "title": "订单行项",
  "description": "销售订单中的明细行。",
  "fields": {
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
    "unitPriceCents": {
      "type": "integer",
      "required": true,
      "description": "单价（分）"
    }
  },
  "relations": {
    "pricingPlan": {
      "resource": "pricingPlan",
      "kind": "one"
    },
    "productCatalogItem": {
      "resource": "productCatalogItem",
      "kind": "one"
    },
    "salesOrder": {
      "resource": "salesOrder",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
