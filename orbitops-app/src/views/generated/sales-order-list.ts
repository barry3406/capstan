import type { ViewDefinition } from "../../types.js";

export const salesOrderListView = {
  "key": "salesOrderList",
  "title": "销售订单列表",
  "kind": "list",
  "resource": "salesOrder",
  "capability": "listSalesOrders"
} satisfies ViewDefinition;
