import type { ResourceDefinition } from "../types.js";

export const commercialContractResource = {
  "key": "commercialContract",
  "title": "商业合同",
  "description": "与客户签订的商业合同。",
  "fields": {
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
    "endDate": {
      "type": "date",
      "required": true,
      "description": "结束日期"
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
  "relations": {
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    },
    "salesOrders": {
      "resource": "salesOrder",
      "kind": "many",
      "description": "关联销售订单"
    }
  }
} satisfies ResourceDefinition;
