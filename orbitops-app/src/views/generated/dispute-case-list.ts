import type { ViewDefinition } from "../../types.js";

export const disputeCaseListView = {
  "key": "disputeCaseList",
  "title": "争议案例列表",
  "kind": "list",
  "resource": "disputeCase",
  "capability": "listDisputeCases"
} satisfies ViewDefinition;
