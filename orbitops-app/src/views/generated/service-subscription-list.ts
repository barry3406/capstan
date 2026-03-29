import type { ViewDefinition } from "../../types.js";

export const serviceSubscriptionListView = {
  "key": "serviceSubscriptionList",
  "title": "服务订阅列表",
  "kind": "list",
  "resource": "serviceSubscription",
  "capability": "listServiceSubscriptions"
} satisfies ViewDefinition;
