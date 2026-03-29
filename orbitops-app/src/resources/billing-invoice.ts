import type { ResourceDefinition } from "../types.js";

export const billingInvoiceResource = {
  "key": "billingInvoice",
  "title": "账单发票",
  "description": "向客户开具的服务账单。",
  "fields": {
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
  "relations": {
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    },
    "payments": {
      "resource": "paymentRecord",
      "kind": "many",
      "description": "关联回款记录"
    },
    "serviceSubscription": {
      "resource": "serviceSubscription",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
