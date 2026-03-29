import type { ViewDefinition } from "../../types.js";

export const syncJobListView = {
  "key": "syncJobList",
  "title": "同步任务列表",
  "kind": "list",
  "resource": "syncJob",
  "capability": "listSyncJobs"
} satisfies ViewDefinition;
