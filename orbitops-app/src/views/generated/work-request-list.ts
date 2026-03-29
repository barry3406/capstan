import type { ViewDefinition } from "../../types.js";

export const workRequestListView = {
  "key": "workRequestList",
  "title": "Work Requests",
  "kind": "list",
  "resource": "workRequest",
  "capability": "listWorkRequests"
} satisfies ViewDefinition;
