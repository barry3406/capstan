import type { TaskDefinition } from "../types.js";

export const syncIntegrationConnectionTaskTask = {
  "key": "syncIntegrationConnectionTask",
  "title": "Sync Integration Connection Task",
  "description": "触发此集成连接器的数据同步。",
  "kind": "durable",
  "artifacts": [
    "syncHealthReport"
  ]
} satisfies TaskDefinition;
