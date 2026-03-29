import type { ViewDefinition } from "../../types.js";

export const reconciliationCaseListView = {
  "key": "reconciliationCaseList",
  "title": "对账案例列表",
  "kind": "list",
  "resource": "reconciliationCase",
  "capability": "listReconciliationCases"
} satisfies ViewDefinition;
