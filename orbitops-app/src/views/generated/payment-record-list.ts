import type { ViewDefinition } from "../../types.js";

export const paymentRecordListView = {
  "key": "paymentRecordList",
  "title": "回款记录列表",
  "kind": "list",
  "resource": "paymentRecord",
  "capability": "listPaymentRecords"
} satisfies ViewDefinition;
