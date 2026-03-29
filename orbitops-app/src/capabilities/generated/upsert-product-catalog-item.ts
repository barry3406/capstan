import type {
  CapabilityDefinition
} from "../../types.js";

export const upsertProductCatalogItemCapability = {
  "key": "upsertProductCatalogItem",
  "title": "创建/编辑产品",
  "mode": "write",
  "input": {
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
