import type { ViewDefinition } from "../../types.js";

export const userListView = {
  "key": "userList",
  "title": "Users",
  "kind": "list",
  "resource": "user",
  "capability": "listUsers"
} satisfies ViewDefinition;
