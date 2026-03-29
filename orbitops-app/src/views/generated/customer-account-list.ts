import type { ViewDefinition } from "../../types.js";

export const customerAccountListView = {
  "key": "customerAccountList",
  "title": "客户账户列表",
  "kind": "list",
  "resource": "customerAccount",
  "capability": "listCustomerAccounts"
} satisfies ViewDefinition;
