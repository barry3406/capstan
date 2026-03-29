import type { ViewDefinition } from "../../types.js";

export const commercialContractListView = {
  "key": "commercialContractList",
  "title": "商业合同列表",
  "kind": "list",
  "resource": "commercialContract",
  "capability": "listCommercialContracts"
} satisfies ViewDefinition;
