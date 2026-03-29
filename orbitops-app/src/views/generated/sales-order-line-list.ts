import type { ViewDefinition } from "../../types.js";

export const salesOrderLineListView = {
  "key": "salesOrderLineList",
  "title": "订单行项列表",
  "kind": "list",
  "resource": "salesOrderLine",
  "capability": "listSalesOrderLines"
} satisfies ViewDefinition;
