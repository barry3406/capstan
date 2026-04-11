import type {
  CapstanContext,
  PolicyAuditEntry,
  PolicyCheckResult,
  PolicyDefinition,
  PolicyEffect,
  PolicyGroup,
} from "./types.js";

// ---------------------------------------------------------------------------
// Policy audit trail
// ---------------------------------------------------------------------------

const policyAuditLog: PolicyAuditEntry[] = [];

/**
 * Record a policy decision in the in-memory audit trail.
 */
function recordPolicyAudit(
  policyKey: string,
  result: PolicyCheckResult,
  ctx: CapstanContext,
  resource?: string,
): void {
  policyAuditLog.push({
    timestamp: new Date().toISOString(),
    policyKey,
    effect: result.effect,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
    ...(result.code !== undefined ? { code: result.code } : {}),
    ...(ctx.auth.userId !== undefined ? { subject: ctx.auth.userId } : {}),
    ...(resource !== undefined ? { resource } : {}),
  });
}

/**
 * Retrieve all policy audit entries.
 */
export function getPolicyAuditLog(): ReadonlyArray<PolicyAuditEntry> {
  return policyAuditLog;
}

/**
 * Clear the policy audit log (useful for tests).
 */
export function clearPolicyAuditLog(): void {
  policyAuditLog.length = 0;
}

// ---------------------------------------------------------------------------
// definePolicy
// ---------------------------------------------------------------------------

/**
 * Define a named permission policy.
 *
 * Policies are evaluated at request time by `enforcePolicies()`. Each policy
 * returns an effect (`allow`, `deny`, `approve`, `redact`) and an optional
 * human-readable reason plus a structured error code.
 *
 * New in this version:
 * - `priority` — numeric priority; higher runs first.
 * - `when` — conditional predicate; policy is skipped if it returns false.
 */
export function definePolicy(def: PolicyDefinition): PolicyDefinition {
  return def;
}

// ---------------------------------------------------------------------------
// Policy composition
// ---------------------------------------------------------------------------

/**
 * Compose multiple policies into a single policy that runs each in sequence.
 *
 * The composed policy uses the key and title of the first policy, prefixed
 * with "composed:".  Priority defaults to the max priority of the inputs.
 *
 * Each sub-policy is evaluated; the most-restrictive result wins.
 */
export function composePolicy(
  ...policies: PolicyDefinition[]
): PolicyDefinition {
  if (policies.length === 0) {
    throw new Error("composePolicy requires at least one policy");
  }

  const maxPriority = Math.max(
    ...policies.map((p) => p.priority ?? 0),
  );

  return {
    key: `composed:${policies.map((p) => p.key).join("+")}`,
    title: `Composed: ${policies.map((p) => p.title).join(" + ")}`,
    effect: policies[0]!.effect,
    priority: maxPriority,
    async check(args) {
      let mostRestrictive: PolicyCheckResult = { effect: "allow" };

      for (const policy of policies) {
        // Respect `when` guard on sub-policies.
        if (policy.when && !policy.when(args)) {
          continue;
        }
        const result = await policy.check(args);
        if (
          EFFECT_SEVERITY[result.effect] >=
          EFFECT_SEVERITY[mostRestrictive.effect]
        ) {
          mostRestrictive = result;
        }
      }

      return mostRestrictive;
    },
  };
}

// ---------------------------------------------------------------------------
// Policy groups
// ---------------------------------------------------------------------------

/**
 * Define a named group of policies that can be applied together.
 *
 * A policy group is a convenience wrapper — it bundles related policies
 * under a name for organizational purposes.  Use `applyPolicyGroup()` to
 * flatten a group back into a plain array of `PolicyDefinition`.
 */
export function definePolicyGroup(
  name: string,
  policies: PolicyDefinition[],
): PolicyGroup {
  return { name, policies };
}

/**
 * Flatten a policy group into an array of `PolicyDefinition`.
 */
export function applyPolicyGroup(group: PolicyGroup): PolicyDefinition[] {
  return group.policies;
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

/**
 * Severity order for policy effects — higher index is more restrictive.
 */
const EFFECT_SEVERITY: Record<PolicyEffect, number> = {
  allow: 0,
  redact: 1,
  approve: 2,
  deny: 3,
};

// ---------------------------------------------------------------------------
// Sort policies by priority (descending — higher priority runs first)
// ---------------------------------------------------------------------------

function sortByPriority(policies: PolicyDefinition[]): PolicyDefinition[] {
  return [...policies].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );
}

// ---------------------------------------------------------------------------
// enforcePolicies
// ---------------------------------------------------------------------------

/**
 * Run all provided policies and return the single most-restrictive result.
 *
 * If no policies are provided the default result is `{ effect: "allow" }`.
 *
 * Evaluation order:
 *  1. Policies are sorted by priority (higher first).
 *  2. Each policy's `when` guard is checked — skipped if false.
 *  3. Every eligible policy is executed (none are short-circuited so that
 *     callers can collect all reasons if desired).
 *  4. The result with the highest severity wins.
 *  5. Ties are broken by evaluation order (later policy wins).
 *  6. Each decision is recorded in the policy audit trail.
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

  // Sort by priority (descending).
  const sorted = sortByPriority(policies);

  const results: Array<{ policy: PolicyDefinition; result: PolicyCheckResult }> = [];

  for (const policy of sorted) {
    // Evaluate conditional guard.
    if (policy.when && !policy.when({ ctx, input })) {
      continue;
    }

    const result = await policy.check({ ctx, input });
    results.push({ policy, result });

    // Record each individual decision in the audit trail.
    recordPolicyAudit(policy.key, result, ctx);
  }

  let mostRestrictive: PolicyCheckResult = { effect: "allow" };
  let winningPolicy: PolicyDefinition | undefined;

  for (const { policy, result } of results) {
    if (
      EFFECT_SEVERITY[result.effect] >=
      EFFECT_SEVERITY[mostRestrictive.effect]
    ) {
      mostRestrictive = result;
      winningPolicy = policy;
    }
  }

  if (ctx.ops) {
    const fallbackPolicy = sorted[0]!;
    const policyForOps = winningPolicy ?? fallbackPolicy;
    await ctx.ops.recordPolicyDecision({
      ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
      ...(mostRestrictive.effect === "deny"
        ? { incidentFingerprint: `policy:${policyForOps.key}:deny` }
        : {}),
      data: {
        policy: policyForOps.key,
        effect: mostRestrictive.effect,
        ...(mostRestrictive.reason ? { reason: mostRestrictive.reason } : {}),
        ...(mostRestrictive.code ? { code: mostRestrictive.code } : {}),
        ...(inputKind ? { inputKind } : {}),
      },
    });
  }

  return mostRestrictive;
}

// ---------------------------------------------------------------------------
// Utility: create a deny result with structured code
// ---------------------------------------------------------------------------

/**
 * Helper to create a deny result with a structured error code.
 */
export function denyWithCode(
  code: string,
  reason: string,
): PolicyCheckResult {
  return { effect: "deny", code, reason };
}

/**
 * Helper to create an allow result.
 */
export function allowResult(): PolicyCheckResult {
  return { effect: "allow" };
}
