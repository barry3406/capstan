import type { ViewDefinition } from "../../types.js";

export const refundRequestListView = {
  "key": "refundRequestList",
  "title": "退款申请列表",
  "kind": "list",
  "resource": "refundRequest",
  "capability": "listRefundRequests"
} satisfies ViewDefinition;
