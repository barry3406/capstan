import type { TaskDefinition } from "../types.js";

export const resolveExceptionCaseTaskTask = {
  "key": "resolveExceptionCaseTask",
  "title": "Resolve Exception Case Task",
  "description": "调查并处理异常案例，支持人工输入和审批。",
  "kind": "durable",
  "artifacts": [
    "exceptionResolutionSummary"
  ]
} satisfies TaskDefinition;
