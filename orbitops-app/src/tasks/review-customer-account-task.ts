import type { TaskDefinition } from "../types.js";

export const reviewCustomerAccountTaskTask = {
  "key": "reviewCustomerAccountTask",
  "title": "Review Customer Account Task",
  "description": "全面审查客户健康状况、订阅、发票与续费风险。",
  "kind": "durable",
  "artifacts": [
    "customerHealthSnapshot"
  ]
} satisfies TaskDefinition;
