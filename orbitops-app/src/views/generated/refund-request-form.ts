import type { ViewDefinition } from "../../types.js";

export const refundRequestFormView = {
  "key": "refundRequestForm",
  "title": "发起退款申请",
  "kind": "form",
  "resource": "refundRequest",
  "capability": "requestRefundRequest"
} satisfies ViewDefinition;
