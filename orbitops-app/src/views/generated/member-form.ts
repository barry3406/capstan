import type { ViewDefinition } from "../../types.js";

export const memberFormView = {
  "key": "memberForm",
  "title": "成员表单",
  "kind": "form",
  "resource": "member",
  "capability": "upsertMember"
} satisfies ViewDefinition;
