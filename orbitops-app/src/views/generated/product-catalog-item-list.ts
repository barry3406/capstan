import type { ViewDefinition } from "../../types.js";

export const productCatalogItemListView = {
  "key": "productCatalogItemList",
  "title": "产品目录列表",
  "kind": "list",
  "resource": "productCatalogItem",
  "capability": "listProductCatalogItems"
} satisfies ViewDefinition;
