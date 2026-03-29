import type { CapabilityExecutionResult } from "../types.js";

export async function upsertSalesOrderLine(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "upsertSalesOrderLine",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/upsert-sales-order-line.ts."
  };
}
