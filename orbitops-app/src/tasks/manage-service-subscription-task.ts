import type { TaskDefinition } from "../types.js";

export const manageServiceSubscriptionTaskTask = {
  "key": "manageServiceSubscriptionTask",
  "title": "Manage Service Subscription Task",
  "description": "管理订阅生命周期：暂停、恢复、取消。",
  "kind": "durable",
  "artifacts": [
    "subscriptionLifecycleRecord"
  ]
} satisfies TaskDefinition;
