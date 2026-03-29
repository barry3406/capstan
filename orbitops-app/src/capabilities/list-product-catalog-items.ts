import type { CapabilityExecutionResult } from "../types.js";

export async function listProductCatalogItems(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listProductCatalogItems",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-product-catalog-items.ts."
  };
}
