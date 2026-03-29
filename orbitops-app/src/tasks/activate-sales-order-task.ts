import type { TaskDefinition } from "../types.js";

export const activateSalesOrderTaskTask = {
  "key": "activateSalesOrderTask",
  "title": "Activate Sales Order Task",
  "description": "从已完成的销售订单激活对应的订阅服务。",
  "kind": "durable",
  "artifacts": [
    "salesOrderActivationReceipt"
  ]
} satisfies TaskDefinition;
