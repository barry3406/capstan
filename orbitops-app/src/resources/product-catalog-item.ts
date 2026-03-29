import type { ResourceDefinition } from "../types.js";

export const productCatalogItemResource = {
  "key": "productCatalogItem",
  "title": "产品目录",
  "description": "可售产品或服务。",
  "fields": {
    "category": {
      "type": "string",
      "required": true,
      "description": "类目"
    },
    "description": {
      "type": "string",
      "required": true,
      "description": "产品描述"
    },
    "sku": {
      "type": "string",
      "required": true,
      "description": "SKU 编码"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "discontinued"
        ]
      }
    },
    "title": {
      "type": "string",
      "required": true,
      "description": "产品名称"
    }
  },
  "relations": {
    "pricingPlans": {
      "resource": "pricingPlan",
      "kind": "many",
      "description": "关联价格计划"
    }
  }
} satisfies ResourceDefinition;
