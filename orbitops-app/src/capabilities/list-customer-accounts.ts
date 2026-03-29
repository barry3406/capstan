import type { CapabilityExecutionResult } from "../types.js";

export async function listCustomerAccounts(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  const limit = typeof input.limit === "number" ? input.limit : 25;
  const offset = typeof input.offset === "number" ? input.offset : 0;

  const mockAccounts = [
    { id: "acct-001", name: "Acme Corp", status: "active", tier: "enterprise", createdAt: "2025-01-15T00:00:00Z" },
    { id: "acct-002", name: "Globex Inc", status: "active", tier: "professional", createdAt: "2025-02-20T00:00:00Z" },
    { id: "acct-003", name: "Initech LLC", status: "suspended", tier: "starter", createdAt: "2025-03-10T00:00:00Z" },
    { id: "acct-004", name: "Umbrella Corp", status: "active", tier: "enterprise", createdAt: "2025-04-05T00:00:00Z" },
    { id: "acct-005", name: "Stark Industries", status: "active", tier: "enterprise", createdAt: "2025-05-12T00:00:00Z" },
  ];

  const filtered = input.status
    ? mockAccounts.filter((a) => a.status === input.status)
    : mockAccounts;

  const page = filtered.slice(offset, offset + limit);

  return {
    capability: "listCustomerAccounts",
    status: "completed",
    input,
    output: {
      accounts: page,
      total: filtered.length,
      limit,
      offset,
    },
  };
}
