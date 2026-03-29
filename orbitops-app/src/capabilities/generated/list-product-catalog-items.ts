import type {
  CapabilityDefinition
} from "../../types.js";

export const listProductCatalogItemsCapability = {
  "key": "listProductCatalogItems",
  "title": "产品列表",
  "mode": "read",
  "output": {
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
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one productCatalogItem record."
    },
    "pricingPlanIds": {
      "type": "json",
      "description": "关联价格计划"
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
  "resources": [
    "productCatalogItem"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
