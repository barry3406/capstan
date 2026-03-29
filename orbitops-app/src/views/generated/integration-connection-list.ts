import type { ViewDefinition } from "../../types.js";

export const integrationConnectionListView = {
  "key": "integrationConnectionList",
  "title": "集成连接器列表",
  "kind": "list",
  "resource": "integrationConnection",
  "capability": "listIntegrationConnections"
} satisfies ViewDefinition;
