import type { CapabilityExecutionResult } from "../types.js";

export async function listSalesOrderLines(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: "listSalesOrderLines",
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/list-sales-order-lines.ts."
  };
}
