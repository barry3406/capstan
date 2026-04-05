import type {
  AgentLoopBeforeToolResult,
  AgentLoopGovernanceContext,
  AgentLoopGovernanceDecision,
  AgentLoopOptions,
} from "../types.js";

export async function resolveToolGovernanceDecision(
  opts: AgentLoopOptions | undefined,
  context: AgentLoopGovernanceContext & { kind: "tool" },
  options?: {
    skip?: boolean;
  },
): Promise<AgentLoopGovernanceDecision> {
  if (options?.skip) {
    const decision: AgentLoopGovernanceDecision = { action: "allow", source: "resume" };
    await opts?.onGovernanceDecision?.({ ...context, decision });
    return decision;
  }

  const decision = normalizeGovernanceDecision(
    await resolveGovernanceInput(
      () => opts?.governToolCall?.(context),
      legacyPolicyToGovernanceDecision(await opts?.beforeToolCall?.(context.name, context.args)),
      context,
    ),
    context,
  );
  await opts?.onGovernanceDecision?.({ ...context, decision });
  return decision;
}

export async function resolveTaskGovernanceDecision(
  opts: AgentLoopOptions | undefined,
  context: AgentLoopGovernanceContext & { kind: "task" },
  options?: {
    skip?: boolean;
  },
): Promise<AgentLoopGovernanceDecision> {
  if (options?.skip) {
    const decision: AgentLoopGovernanceDecision = { action: "allow", source: "resume" };
    await opts?.onGovernanceDecision?.({ ...context, decision });
    return decision;
  }

  const decision = normalizeGovernanceDecision(
    await resolveGovernanceInput(
      () => opts?.governTaskCall?.(context),
      legacyPolicyToGovernanceDecision(await opts?.beforeTaskCall?.(context.name, context.args)),
      context,
    ),
    context,
  );
  await opts?.onGovernanceDecision?.({ ...context, decision });
  return decision;
}

export function legacyPolicyToGovernanceDecision(
  policy: AgentLoopBeforeToolResult | undefined,
): AgentLoopGovernanceDecision {
  if (!policy) {
    return { action: "allow", source: "legacy_default" };
  }
  if (policy.allowed) {
    return { action: "allow", source: "legacy_policy" };
  }
  return {
    action: "require_approval",
    source: "legacy_policy",
    ...(policy.reason ? { reason: policy.reason } : {}),
  };
}

async function resolveGovernanceInput(
  primary: () => Promise<AgentLoopGovernanceDecision | undefined> | AgentLoopGovernanceDecision | undefined,
  fallback: AgentLoopGovernanceDecision,
  context: AgentLoopGovernanceContext,
): Promise<AgentLoopGovernanceDecision> {
  try {
    return (await primary()) ?? fallback;
  } catch (error) {
    return {
      action: "deny",
      source: "governance_error",
      reason: `Governance hook failed for ${context.kind} "${context.name}": ${formatGovernanceError(error)}`,
    };
  }
}

function normalizeGovernanceDecision(
  value: AgentLoopGovernanceDecision,
  context: AgentLoopGovernanceContext,
): AgentLoopGovernanceDecision {
  if (!isGovernanceAction(value?.action)) {
    return {
      action: "deny",
      source: "governance_validation",
      reason: `Invalid governance decision returned for ${context.kind} "${context.name}"`,
    };
  }

  return {
    action: value.action,
    ...(typeof value.reason === "string" && value.reason.trim()
      ? { reason: value.reason }
      : {}),
    ...(typeof value.policyId === "string" && value.policyId.trim()
      ? { policyId: value.policyId }
      : {}),
    ...(isGovernanceRisk(value.risk) ? { risk: value.risk } : {}),
    ...(typeof value.source === "string" && value.source.trim()
      ? { source: value.source }
      : {}),
    ...(isPlainObject(value.metadata)
      ? { metadata: structuredClone(value.metadata) as Record<string, unknown> }
      : {}),
  };
}

function isGovernanceAction(value: unknown): value is AgentLoopGovernanceDecision["action"] {
  return value === "allow" || value === "require_approval" || value === "deny";
}

function isGovernanceRisk(value: unknown): value is NonNullable<AgentLoopGovernanceDecision["risk"]> {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function formatGovernanceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
