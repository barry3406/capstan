import type { TaskDefinition } from "../types.js";

export const reconcileReconciliationCaseTaskTask = {
  "key": "reconcileReconciliationCaseTask",
  "title": "Reconcile Reconciliation Case Task",
  "description": "对指定期间的收入进行对账。",
  "kind": "durable",
  "artifacts": [
    "revenueReconciliationCaseReport"
  ]
} satisfies TaskDefinition;
