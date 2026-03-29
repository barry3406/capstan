import type { ViewDefinition } from "../../types.js";

export const approvalRequestListView = {
  "key": "approvalRequestList",
  "title": "审批请求列表",
  "kind": "list",
  "resource": "approvalRequest",
  "capability": "listApprovalRequests"
} satisfies ViewDefinition;
