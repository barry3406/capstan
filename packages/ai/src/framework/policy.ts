import {
  dedupeContracts,
  frameworkError,
  freezeDeep,
  normalizeId,
  normalizeJsonObject,
  normalizeStringList,
  normalizeText,
  normalizeTitle,
  stableJson,
} from "./shared.js";
import type {
  AgentPolicyContract,
  AgentPolicyFallbackContract,
  AgentPolicyFallbackInput,
  AgentPolicyInput,
  AgentPolicyRuleContract,
  AgentPolicyRuleInput,
  AgentPolicyTargetContract,
  AgentPolicyTargetInput,
  AgentRiskLevel,
} from "./types.js";

const POLICY_ACTIONS = ["allow", "require_approval", "deny"] as const;
const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

function normalizeRisk(value: unknown, path: string, defaultValue: AgentRiskLevel): AgentRiskLevel {
  const candidate = value ?? defaultValue;
  if (!RISK_LEVELS.includes(candidate as AgentRiskLevel)) {
    throw frameworkError("invalid_risk", `${path} is not supported`, path);
  }
  return candidate as AgentRiskLevel;
}

function normalizeTarget(input: AgentPolicyTargetInput, path: string): AgentPolicyTargetContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", `${path} must be a plain object`, path);
  }

  const kind = input.kind;
  if (!["capability", "workflow", "memory_space", "operator_view", "tool", "task"].includes(kind)) {
    throw frameworkError("invalid_target_kind", `${path}.kind is not supported`, `${path}.kind`);
  }

  const ids = normalizeStringList(input.ids, `${path}.ids`, { mode: "id" });
  if (ids.length === 0) {
    throw frameworkError("missing_target_ids", `${path}.ids must contain at least one id`, `${path}.ids`);
  }

  return freezeDeep({ kind, ids });
}

function normalizeRule(input: AgentPolicyRuleInput, path: string): AgentPolicyRuleContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", `${path} must be a plain object`, path);
  }

  if (!POLICY_ACTIONS.includes(input.action)) {
    throw frameworkError("invalid_policy_action", `${path}.action is not supported`, `${path}.action`);
  }

  if (!Array.isArray(input.appliesTo) || input.appliesTo.length === 0) {
    throw frameworkError("missing_policy_targets", `${path}.appliesTo must not be empty`, `${path}.appliesTo`);
  }

  const metadata = normalizeJsonObject(input.metadata, `${path}.metadata`);

  return freezeDeep({
    id: normalizeId(input.id, `${path}.id`),
    appliesTo: Object.freeze(
      input.appliesTo.map((target, index) => normalizeTarget(target, `${path}.appliesTo[${index}]`)),
    ) as readonly AgentPolicyTargetContract[],
    action: input.action,
    reason: normalizeText(input.reason, `${path}.reason`),
    risk: normalizeRisk(input.risk, `${path}.risk`, "medium"),
    ...(metadata === undefined ? {} : { metadata }),
  });
}

function normalizeFallback(input: AgentPolicyFallbackInput | undefined): AgentPolicyFallbackContract {
  if (input === undefined) {
    return freezeDeep({
      action: "deny",
      reason: "Deny by default when no policy rule matches.",
      risk: "medium",
    });
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "policy.fallback must be a plain object", "policy.fallback");
  }

  if (!POLICY_ACTIONS.includes(input.action)) {
    throw frameworkError(
      "invalid_policy_action",
      "policy.fallback.action is not supported",
      "policy.fallback.action",
    );
  }

  return freezeDeep({
    action: input.action,
    reason: normalizeText(input.reason, "policy.fallback.reason"),
    risk: normalizeRisk(input.risk, "policy.fallback.risk", "medium"),
  });
}

function normalizePolicyInput(input: AgentPolicyInput): AgentPolicyContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "policy must be a plain object", "policy");
  }

  if (!Array.isArray(input.rules) || input.rules.length === 0) {
    throw frameworkError("missing_policy_rules", "policy.rules must contain at least one rule", "policy.rules");
  }

  const id = normalizeId(input.id, "policy.id");
  const metadata = normalizeJsonObject(input.metadata, "policy.metadata");

  return freezeDeep({
    kind: "policy",
    id,
    title: normalizeTitle(input.title, id, "policy.title"),
    description: normalizeText(input.description, "policy.description"),
    tags: normalizeStringList(input.tags, "policy.tags"),
    ...(metadata === undefined ? {} : { metadata }),
    rules: dedupeContracts(
      "policy_rule",
      input.rules.map((rule, index) => normalizeRule(rule, `policy.rules[${index}]`)),
    ),
    fallback: normalizeFallback(input.fallback),
  });
}

export function defineAgentPolicy(input: AgentPolicyInput): AgentPolicyContract {
  return normalizePolicyInput(input);
}

export function dedupePolicies(
  items: readonly AgentPolicyInput[],
): readonly AgentPolicyContract[] {
  return dedupeContracts("policy", items.map((item) => normalizePolicyInput(item)));
}

export function policySignature(input: AgentPolicyInput): string {
  return stableJson(normalizePolicyInput(input));
}
