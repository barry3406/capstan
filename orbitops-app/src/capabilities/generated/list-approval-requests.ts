import type {
  CapabilityDefinition
} from "../../types.js";

export const listApprovalRequestsCapability = {
  "key": "listApprovalRequests",
  "title": "审批列表",
  "mode": "read",
  "output": {
    "assignedToId": {
      "type": "string",
      "required": true,
      "description": "审批人 ID"
    },
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
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
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one approvalRequest record."
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
  "resources": [
    "approvalRequest"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
