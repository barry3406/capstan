import type { TaskDefinition } from "../types.js";

export const decideApprovalRequestTaskTask = {
  "key": "decideApprovalRequestTask",
  "title": "Decide Approval Request Task",
  "description": "处理审批请求：批准或拒绝，可附加意见。",
  "kind": "durable",
  "artifacts": [
    "approvalDecisionRecord"
  ]
} satisfies TaskDefinition;
