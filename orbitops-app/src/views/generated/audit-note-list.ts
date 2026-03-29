import type { ViewDefinition } from "../../types.js";

export const auditNoteListView = {
  "key": "auditNoteList",
  "title": "审计备注列表",
  "kind": "list",
  "resource": "auditNote",
  "capability": "listAuditNotes"
} satisfies ViewDefinition;
