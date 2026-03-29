import type {
  CapabilityDefinition
} from "../../types.js";

export const upsertCustomerAccountCapability = {
  "key": "upsertCustomerAccount",
  "title": "创建/编辑客户",
  "mode": "write",
  "input": {
    "contactIds": {
      "type": "json",
      "description": "关联联系人"
    },
    "contractIds": {
      "type": "json",
      "description": "关联合同"
    },
    "domain": {
      "type": "string",
      "required": true,
      "description": "客户域名"
    },
    "externalId": {
      "type": "string",
      "required": true,
      "description": "外部系统 ID"
    },
    "healthScore": {
      "type": "number",
      "required": true,
      "description": "健康评分"
    },
    "industry": {
      "type": "string",
      "required": true,
      "description": "所属行业"
    },
    "invoiceIds": {
      "type": "json",
      "description": "关联发票"
    },
    "name": {
      "type": "string",
      "required": true,
      "description": "客户名称"
    },
    "orderIds": {
      "type": "json",
      "description": "关联订单"
    },
    "renewalOpportunitieIds": {
      "type": "json",
      "description": "关联续费机会"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "churn_risk",
          "churned",
          "prospect"
        ]
      }
    },
    "subscriptionIds": {
      "type": "json",
      "description": "关联订阅"
    },
    "tier": {
      "type": "string",
      "required": true,
      "description": "客户层级",
      "constraints": {
        "enum": [
          "enterprise",
          "mid_market",
          "smb"
        ]
      }
    },
    "workspaceId": {
      "type": "string",
      "description": "Reference to one related workspace record."
    }
  },
  "output": {
    "contactIds": {
      "type": "json",
      "description": "关联联系人"
    },
    "contractIds": {
      "type": "json",
      "description": "关联合同"
    },
    "domain": {
      "type": "string",
      "required": true,
      "description": "客户域名"
    },
    "externalId": {
      "type": "string",
      "required": true,
      "description": "外部系统 ID"
    },
    "healthScore": {
      "type": "number",
      "required": true,
      "description": "健康评分"
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one customerAccount record."
    },
    "industry": {
      "type": "string",
      "required": true,
      "description": "所属行业"
    },
    "invoiceIds": {
      "type": "json",
      "description": "关联发票"
    },
    "name": {
      "type": "string",
      "required": true,
      "description": "客户名称"
    },
    "orderIds": {
      "type": "json",
      "description": "关联订单"
    },
    "renewalOpportunitieIds": {
      "type": "json",
      "description": "关联续费机会"
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "active",
          "churn_risk",
          "churned",
          "prospect"
        ]
      }
    },
    "subscriptionIds": {
      "type": "json",
      "description": "关联订阅"
    },
    "tier": {
      "type": "string",
      "required": true,
      "description": "客户层级",
      "constraints": {
        "enum": [
          "enterprise",
          "mid_market",
          "smb"
        ]
      }
    },
    "workspaceId": {
      "type": "string",
      "description": "Reference to one related workspace record."
    }
  },
  "resources": [
    "customerAccount"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
