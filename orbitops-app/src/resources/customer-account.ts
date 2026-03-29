import type { ResourceDefinition } from "../types.js";

export const customerAccountResource = {
  "key": "customerAccount",
  "title": "客户账户",
  "description": "收入运营中管理的客户主体。",
  "fields": {
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
    "name": {
      "type": "string",
      "required": true,
      "description": "客户名称"
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
    }
  },
  "relations": {
    "contacts": {
      "resource": "customerContact",
      "kind": "many",
      "description": "关联联系人"
    },
    "contracts": {
      "resource": "commercialContract",
      "kind": "many",
      "description": "关联合同"
    },
    "invoices": {
      "resource": "billingInvoice",
      "kind": "many",
      "description": "关联发票"
    },
    "orders": {
      "resource": "salesOrder",
      "kind": "many",
      "description": "关联订单"
    },
    "renewalOpportunities": {
      "resource": "renewalOpportunity",
      "kind": "many",
      "description": "关联续费机会"
    },
    "subscriptions": {
      "resource": "serviceSubscription",
      "kind": "many",
      "description": "关联订阅"
    },
    "workspace": {
      "resource": "workspace",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
