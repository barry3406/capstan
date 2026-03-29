import type { ResourceDefinition } from "../types.js";

export const pricingPlanResource = {
  "key": "pricingPlan",
  "title": "价格计划",
  "description": "挂在产品目录项下的定价方案。",
  "fields": {
    "basePriceCents": {
      "type": "integer",
      "required": true,
      "description": "基础价格（分）"
    },
    "billingInterval": {
      "type": "string",
      "required": true,
      "description": "计费周期",
      "constraints": {
        "enum": [
          "annual",
          "monthly",
          "quarterly"
        ]
      }
    },
    "currency": {
      "type": "string",
      "required": true,
      "description": "币种",
      "constraints": {
        "maxLength": 3
      }
    },
    "name": {
      "type": "string",
      "required": true,
      "description": "计划名称"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "archived",
          "deprecated"
        ]
      }
    }
  },
  "relations": {
    "productCatalogItem": {
      "resource": "productCatalogItem",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
