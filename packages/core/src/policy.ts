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
  const inputKind =
    input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
  if (policies.length === 0) {
    if (ctx.ops) {
      await ctx.ops.recordPolicyDecision({
        ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
        ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
        data: {
          policy: "none",
          effect: "allow",
          reason: "No policies configured",
          inputKind,
        },
      });
    }
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

  if (ctx.ops) {
    const fallbackPolicy = policies[0]!;
    let winningPolicy = fallbackPolicy;
    for (let index = results.length - 1; index >= 0; index -= 1) {
      if (results[index]?.effect === mostRestrictive.effect) {
        winningPolicy = policies[index] ?? winningPolicy;
        break;
      }
    }
    await ctx.ops.recordPolicyDecision({
      ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
      ...(mostRestrictive.effect === "deny"
        ? { incidentFingerprint: `policy:${winningPolicy.key}:deny` }
        : {}),
      data: {
        policy: winningPolicy.key,
        effect: mostRestrictive.effect,
        ...(mostRestrictive.reason ? { reason: mostRestrictive.reason } : {}),
        ...(inputKind ? { inputKind } : {}),
      },
    });
  }

  return mostRestrictive;
}
