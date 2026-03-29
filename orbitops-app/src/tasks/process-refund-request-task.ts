import type { TaskDefinition } from "../types.js";

export const processRefundRequestTaskTask = {
  "key": "processRefundRequestTask",
  "title": "Process Refund Request Task",
  "description": "处理退款申请：校验、审批、执行退款。",
  "kind": "durable",
  "artifacts": [
    "refundExecutionReceipt"
  ]
} satisfies TaskDefinition;
