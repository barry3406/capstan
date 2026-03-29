import type { ViewDefinition } from "../../types.js";

export const syncJobFormView = {
  "key": "syncJobForm",
  "title": "同步任务表单",
  "kind": "form",
  "resource": "syncJob",
  "capability": "upsertSyncJob"
} satisfies ViewDefinition;
