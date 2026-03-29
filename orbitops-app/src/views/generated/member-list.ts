import type { ViewDefinition } from "../../types.js";

export const memberListView = {
  "key": "memberList",
  "title": "成员列表",
  "kind": "list",
  "resource": "member",
  "capability": "listMembers"
} satisfies ViewDefinition;
