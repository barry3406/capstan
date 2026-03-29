import type {
  CapabilityDefinition
} from "../../types.js";

export const upsertPricingPlanCapability = {
  "key": "upsertPricingPlan",
  "title": "创建/编辑价格计划",
  "mode": "write",
  "input": {
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
    "productCatalogItemId": {
      "type": "string",
      "description": "Reference to one related productCatalogItem record."
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
  "output": {
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
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one pricingPlan record."
    },
    "name": {
      "type": "string",
      "required": true,
      "description": "计划名称"
    },
    "productCatalogItemId": {
      "type": "string",
      "description": "Reference to one related productCatalogItem record."
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
  "resources": [
    "pricingPlan"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
