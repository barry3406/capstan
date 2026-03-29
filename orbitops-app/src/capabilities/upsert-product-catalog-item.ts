import type { CapabilityExecutionResult } from "../types.js";

export async function upsertProductCatalogItem(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertProductCatalogItem",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-product-catalog-item.ts."
  };
}
