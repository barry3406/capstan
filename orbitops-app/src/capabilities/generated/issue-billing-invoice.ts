import type {
  CapabilityDefinition
} from "../../types.js";

export const issueBillingInvoiceCapability = {
  "key": "issueBillingInvoice",
  "title": "开具发票",
  "mode": "write",
  "input": {
    "amountCents": {
      "type": "integer",
      "required": true,
      "description": "金额（分）"
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
    "dueDate": {
      "type": "date",
      "required": true,
      "description": "到期日"
    },
    "invoiceNumber": {
      "type": "string",
      "required": true,
      "description": "发票编号"
    },
    "issuedDate": {
      "type": "date",
      "required": true,
      "description": "开票日期"
    },
    "paymentIds": {
      "type": "json",
      "description": "关联回款记录"
    },
    "serviceSubscriptionId": {
      "type": "string",
      "description": "Reference to one related serviceSubscription record."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "draft",
          "overdue",
          "paid",
          "sent",
          "void",
          "written_off"
        ]
      }
    }
  },
  "output": {
    "amountCents": {
      "type": "integer",
      "required": true,
      "description": "金额（分）"
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
    "dueDate": {
      "type": "date",
      "required": true,
      "description": "到期日"
    },
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one billingInvoice record."
    },
    "invoiceNumber": {
      "type": "string",
      "required": true,
      "description": "发票编号"
    },
    "issuedDate": {
      "type": "date",
      "required": true,
      "description": "开票日期"
    },
    "paymentIds": {
      "type": "json",
      "description": "关联回款记录"
    },
    "serviceSubscriptionId": {
      "type": "string",
      "description": "Reference to one related serviceSubscription record."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "draft",
          "overdue",
          "paid",
          "sent",
          "void",
          "written_off"
        ]
      }
    }
  },
  "resources": [
    "billingInvoice"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
