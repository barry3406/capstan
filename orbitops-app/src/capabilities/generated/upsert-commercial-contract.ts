import type {
  CapabilityDefinition
} from "../../types.js";

export const upsertCommercialContractCapability = {
  "key": "upsertCommercialContract",
  "title": "创建/编辑合同",
  "mode": "write",
  "input": {
    "contractNumber": {
      "type": "string",
      "required": true,
      "description": "合同编号"
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
    "endDate": {
      "type": "date",
      "required": true,
      "description": "结束日期"
    },
    "salesOrderIds": {
      "type": "json",
      "description": "关联销售订单"
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
          "draft",
          "expired",
          "terminated"
        ]
      }
    },
    "totalValueCents": {
      "type": "integer",
      "required": true,
      "description": "合同总金额（分）"
    }
  },
  "output": {
    "contractNumber": {
      "type": "string",
      "required": true,
      "description": "合同编号"
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
    "endDate": {
      "type": "date",
      "required": true,
      "description": "结束日期"
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one commercialContract record."
    },
    "salesOrderIds": {
      "type": "json",
      "description": "关联销售订单"
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
          "draft",
          "expired",
          "terminated"
        ]
      }
    },
    "totalValueCents": {
      "type": "integer",
      "required": true,
      "description": "合同总金额（分）"
    }
  },
  "resources": [
    "commercialContract"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
