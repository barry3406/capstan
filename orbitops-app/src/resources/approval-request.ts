import type { ResourceDefinition } from "../types.js";

export const approvalRequestResource = {
  "key": "approvalRequest",
  "title": "审批请求",
  "description": "由业务操作触发的审批请求（折扣、退款、发票、核销等）。",
  "fields": {
    "assignedToId": {
      "type": "string",
      "required": true,
      "description": "审批人 ID"
    },
    "decision": {
      "type": "string",
      "required": true,
      "description": "审批决定",
      "constraints": {
        "enum": [
          "approved",
          "pending",
          "rejected"
        ]
      }
    },
    "decisionNote": {
      "type": "string",
      "required": true,
      "description": "审批意见"
    },
    "reason": {
      "type": "string",
      "required": true,
      "description": "原因说明"
    },
    "requestedById": {
      "type": "string",
      "required": true,
      "description": "申请人 ID"
    },
    "requestType": {
      "type": "string",
      "required": true,
      "description": "审批类型",
      "constraints": {
        "enum": [
          "discount_approval",
          "generic",
          "invoice_approval",
          "refund_approval",
          "writeoff_approval"
        ]
      }
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "状态",
      "constraints": {
        "enum": [
          "approved",
          "expired",
          "pending",
          "rejected"
        ]
      }
    },
    "subjectResourceId": {
      "type": "string",
      "required": true,
      "description": "关联资源 ID"
    },
    "subjectResourceKey": {
      "type": "string",
      "required": true,
      "description": "关联资源类型"
    }
  },
  "relations": {
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
