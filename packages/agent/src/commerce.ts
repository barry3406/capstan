export interface PaymentMandate {
  /** Unique mandate ID */
  id: string;
  /** Maximum amount authorized */
  maxAmount: number;
  /** Currency code (ISO 4217) */
  currency: string;
  /** Mandate expiry (ISO 8601) */
  expiresAt: string;
  /** User who authorized this mandate */
  authorizedBy: string;
  /** Cryptographic signature of the mandate */
  signature?: string;
}

export interface TransactionConfig {
  /** Transaction name for discovery */
  name: string;
  /** Amount calculator */
  amount: (input: unknown) => number;
  /** Currency (default: USD) */
  currency?: string;
  /** Maximum amount per transaction */
  maxAmount?: number;
}

export interface TransactionResult {
  transactionId: string;
  amount: number;
  currency: string;
  status: "completed" | "pending" | "failed";
  mandateId?: string;
}

/**
 * Define a transactable API endpoint.
 * When an agent calls this, it must present a valid payment mandate.
 */
export function defineTransaction(config: TransactionConfig): TransactionConfig {
  return config;
}

/**
 * Validate a payment mandate.
 */
export function validateMandate(mandate: PaymentMandate): { valid: boolean; reason?: string } {
  if (!mandate.id) return { valid: false, reason: "Missing mandate ID" };
  if (!mandate.maxAmount || mandate.maxAmount <= 0) return { valid: false, reason: "Invalid amount" };
  if (!mandate.currency) return { valid: false, reason: "Missing currency" };
  if (new Date(mandate.expiresAt) < new Date()) return { valid: false, reason: "Mandate expired" };
  if (!mandate.authorizedBy) return { valid: false, reason: "Missing authorization" };
  return { valid: true };
}

/**
 * Create a metered usage tracker for API calls.
 */
export class UsageMeter {
  private usage = new Map<string, { calls: number; totalAmount: number }>();

  record(agentId: string, amount: number): void {
    const current = this.usage.get(agentId) ?? { calls: 0, totalAmount: 0 };
    current.calls++;
    current.totalAmount += amount;
    this.usage.set(agentId, current);
  }

  getUsage(agentId: string) { return this.usage.get(agentId) ?? { calls: 0, totalAmount: 0 }; }
  getAllUsage() { return Object.fromEntries(this.usage); }
  reset() { this.usage.clear(); }
}
