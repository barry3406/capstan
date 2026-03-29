import type {
  CapstanContext,
  PolicyCheckResult,
  PolicyDefinition,
  PolicyEffect,
} from "./types.js";

/**
 * Define a named permission policy.
 *
 * Policies are evaluated at request time by `enforcePolicies()`. Each policy
 * returns an effect (`allow`, `deny`, `approve`, `redact`) and an optional
 * human-readable reason.
 */
export function definePolicy(def: PolicyDefinition): PolicyDefinition {
  return def;
}

/**
 * Severity order for policy effects — higher index is more restrictive.
 */
const EFFECT_SEVERITY: Record<PolicyEffect, number> = {
  allow: 0,
  redact: 1,
  approve: 2,
  deny: 3,
};

/**
 * Run all provided policies and return the single most-restrictive result.
 *
 * If no policies are provided the default result is `{ effect: "allow" }`.
 *
 * Evaluation order:
 *  1. Every policy in the array is executed (none are short-circuited so that
 *     callers can collect all reasons if desired).
 *  2. The result with the highest severity wins.
 *  3. Ties are broken by array order (later policy wins).
 */
export async function enforcePolicies(
  policies: PolicyDefinition[],
  ctx: CapstanContext,
  input?: unknown,
): Promise<PolicyCheckResult> {
  if (policies.length === 0) {
    return { effect: "allow" };
  }

  const results = await Promise.all(
    policies.map((p) => p.check({ ctx, input })),
  );

  let mostRestrictive: PolicyCheckResult = { effect: "allow" };

  for (const result of results) {
    if (
      EFFECT_SEVERITY[result.effect] >=
      EFFECT_SEVERITY[mostRestrictive.effect]
    ) {
      mostRestrictive = result;
    }
  }

  return mostRestrictive;
}
