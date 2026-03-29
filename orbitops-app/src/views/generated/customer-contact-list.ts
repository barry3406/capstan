import type { ViewDefinition } from "../../types.js";

export const customerContactListView = {
  "key": "customerContactList",
  "title": "客户联系人列表",
  "kind": "list",
  "resource": "customerContact",
  "capability": "listCustomerContacts"
} satisfies ViewDefinition;
