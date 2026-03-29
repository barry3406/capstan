import type { TaskDefinition } from "../types.js";

export const processWorkRequestTaskTask = {
  "key": "processWorkRequestTask",
  "title": "Process Work Request Task",
  "description": "Durably processes one work request through review and completion.",
  "kind": "durable",
  "artifacts": [
    "workRequestReport"
  ]
} satisfies TaskDefinition;
