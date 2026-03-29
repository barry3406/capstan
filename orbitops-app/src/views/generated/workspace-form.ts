import type { ViewDefinition } from "../../types.js";

export const workspaceFormView = {
  "key": "workspaceForm",
  "title": "工作空间表单",
  "kind": "form",
  "resource": "workspace",
  "capability": "upsertWorkspace"
} satisfies ViewDefinition;
