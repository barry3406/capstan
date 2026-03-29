import type { ViewDefinition } from "../../types.js";

export const workspaceListView = {
  "key": "workspaceList",
  "title": "工作空间列表",
  "kind": "list",
  "resource": "workspace",
  "capability": "listWorkspaces"
} satisfies ViewDefinition;
