import type { ViewDefinition } from "../../types.js";

export const serviceSubscriptionFormView = {
  "key": "serviceSubscriptionForm",
  "title": "服务订阅表单",
  "kind": "form",
  "resource": "serviceSubscription",
  "capability": "upsertServiceSubscription"
} satisfies ViewDefinition;
