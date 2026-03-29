import type { ViewDefinition } from "../../types.js";

export const approvalRequestDetailView = {
  "key": "approvalRequestDetail",
  "title": "审批请求详情",
  "kind": "detail",
  "resource": "approvalRequest",
  "capability": "decideApprovalRequest"
} satisfies ViewDefinition;
