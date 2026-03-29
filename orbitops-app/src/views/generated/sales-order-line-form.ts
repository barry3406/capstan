import type { ViewDefinition } from "../../types.js";

export const salesOrderLineFormView = {
  "key": "salesOrderLineForm",
  "title": "订单行项表单",
  "kind": "form",
  "resource": "salesOrderLine",
  "capability": "upsertSalesOrderLine"
} satisfies ViewDefinition;
