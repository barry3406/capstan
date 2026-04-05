import {
  assertReferencedIds,
  dedupeContracts,
  frameworkError,
  freezeDeep,
  makeCatalog,
  normalizeId,
  normalizeJsonObject,
  normalizeStringList,
  normalizeText,
  normalizeTitle,
  stableJson,
} from "./shared.js";
import { defineCapability } from "./capability.js";
import { defineWorkflow } from "./workflow.js";
import { defineAgentPolicy } from "./policy.js";
import { defineMemorySpace } from "./memory-space.js";
import { defineOperatorView } from "./operator-view.js";
import type {
  AgentAppCatalog,
  AgentAppContract,
  AgentAppDefaultsContract,
  AgentAppInput,
  AgentAppSummary,
  AgentPolicyTargetKind,
} from "./types.js";

function normalizeDefaults(input: AgentAppInput["defaults"]): AgentAppDefaultsContract {
  return freezeDeep({
    ...(input?.defaultWorkflow === undefined
      ? {}
      : { defaultWorkflow: normalizeId(input.defaultWorkflow, "agent_app.defaults.defaultWorkflow") }),
    defaultPolicies: normalizeStringList(
      input?.defaultPolicies,
      "agent_app.defaults.defaultPolicies",
      { mode: "id" },
    ),
    defaultMemorySpaces: normalizeStringList(
      input?.defaultMemorySpaces,
      "agent_app.defaults.defaultMemorySpaces",
      { mode: "id" },
    ),
  });
}

function isLocalPolicyTarget(
  kind: AgentPolicyTargetKind,
): kind is "capability" | "workflow" | "memory_space" | "operator_view" {
  return kind === "capability"
    || kind === "workflow"
    || kind === "memory_space"
    || kind === "operator_view";
}

function normalizeAgentApp(input: AgentAppInput): AgentAppContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "agent_app must be a plain object", "agent_app");
  }

  const capabilities = dedupeContracts(
    "capability",
    input.capabilities.map((item) => defineCapability(item)),
  );
  if (capabilities.length === 0) {
    throw frameworkError(
      "missing_capabilities",
      "agent_app.capabilities must contain at least one capability",
      "agent_app.capabilities",
    );
  }

  const workflows = dedupeContracts("workflow", (input.workflows ?? []).map((item) => defineWorkflow(item)));
  const policies = dedupeContracts("policy", (input.policies ?? []).map((item) => defineAgentPolicy(item)));
  const memorySpaces = dedupeContracts(
    "memory_space",
    (input.memorySpaces ?? []).map((item) => defineMemorySpace(item)),
  );
  const operatorViews = dedupeContracts(
    "operator_view",
    (input.operatorViews ?? []).map((item) => defineOperatorView(item)),
  );

  const indexes: AgentAppCatalog = freezeDeep({
    capabilities: makeCatalog(capabilities),
    workflows: makeCatalog(workflows),
    policies: makeCatalog(policies),
    memorySpaces: makeCatalog(memorySpaces),
    operatorViews: makeCatalog(operatorViews),
  });

  for (const capability of capabilities) {
    assertReferencedIds(
      capability.defaultPolicies,
      indexes.policies,
      `capability.${capability.id}.defaultPolicies`,
    );
    assertReferencedIds(
      capability.defaultMemorySpaces,
      indexes.memorySpaces,
      `capability.${capability.id}.defaultMemorySpaces`,
    );
  }

  for (const workflow of workflows) {
    assertReferencedIds([workflow.entryCapability], indexes.capabilities, `workflow.${workflow.id}.entryCapability`);
    for (const stage of workflow.stages) {
      assertReferencedIds(
        [stage.capability],
        indexes.capabilities,
        `workflow.${workflow.id}.stages.${stage.id}.capability`,
      );
    }
    assertReferencedIds(workflow.defaultPolicies, indexes.policies, `workflow.${workflow.id}.defaultPolicies`);
    assertReferencedIds(
      workflow.defaultMemorySpaces,
      indexes.memorySpaces,
      `workflow.${workflow.id}.defaultMemorySpaces`,
    );
  }

  for (const policy of policies) {
    for (const rule of policy.rules) {
      for (const target of rule.appliesTo) {
        if (!isLocalPolicyTarget(target.kind)) {
          continue;
        }
        const catalog = target.kind === "capability"
          ? indexes.capabilities
          : target.kind === "workflow"
            ? indexes.workflows
            : target.kind === "memory_space"
              ? indexes.memorySpaces
              : indexes.operatorViews;
        assertReferencedIds(target.ids, catalog, `policy.${policy.id}.rules.${rule.id}.appliesTo`);
      }
    }
  }

  for (const view of operatorViews) {
    assertReferencedIds(
      view.filters.capabilityIds,
      indexes.capabilities,
      `operator_view.${view.id}.filters.capabilityIds`,
    );
    assertReferencedIds(
      view.filters.workflowIds,
      indexes.workflows,
      `operator_view.${view.id}.filters.workflowIds`,
    );
    assertReferencedIds(
      view.filters.policyIds,
      indexes.policies,
      `operator_view.${view.id}.filters.policyIds`,
    );
    assertReferencedIds(
      view.filters.memorySpaceIds,
      indexes.memorySpaces,
      `operator_view.${view.id}.filters.memorySpaceIds`,
    );
  }

  const defaults = normalizeDefaults(input.defaults);
  if (defaults.defaultWorkflow !== undefined) {
    assertReferencedIds([defaults.defaultWorkflow], indexes.workflows, "agent_app.defaults.defaultWorkflow");
  }
  assertReferencedIds(defaults.defaultPolicies, indexes.policies, "agent_app.defaults.defaultPolicies");
  assertReferencedIds(defaults.defaultMemorySpaces, indexes.memorySpaces, "agent_app.defaults.defaultMemorySpaces");

  const id = normalizeId(input.id, "agent_app.id");
  const metadata = normalizeJsonObject(input.metadata, "agent_app.metadata");

  return freezeDeep({
    kind: "agent_app",
    id,
    title: normalizeTitle(input.title, id, "agent_app.title"),
    description: normalizeText(input.description, "agent_app.description"),
    tags: normalizeStringList(input.tags, "agent_app.tags"),
    ...(metadata === undefined ? {} : { metadata }),
    capabilities,
    workflows,
    policies,
    memorySpaces,
    operatorViews,
    defaults,
    indexes,
  });
}

export function defineAgentApp(input: AgentAppInput): AgentAppContract {
  return normalizeAgentApp(input);
}

export function appSignature(input: AgentAppInput): string {
  return stableJson(normalizeAgentApp(input));
}

export function summarizeAgentApp(app: AgentAppContract): AgentAppSummary {
  return freezeDeep({
    id: app.id,
    title: app.title,
    description: app.description,
    defaults: {
      ...(app.defaults.defaultWorkflow === undefined
        ? {}
        : { defaultWorkflow: app.defaults.defaultWorkflow }),
      defaultPolicies: [...app.defaults.defaultPolicies],
      defaultMemorySpaces: [...app.defaults.defaultMemorySpaces],
    },
    capabilities: app.capabilities.map(({ id, title, description }) => ({ id, title, description })),
    workflows: app.workflows.map(({ id, title, description, entryCapability }) => ({
      id,
      title,
      description,
      entryCapability,
    })),
    policies: app.policies.map(({ id, title, description }) => ({ id, title, description })),
    memorySpaces: app.memorySpaces.map(({ id, title, description, scope }) => ({
      id,
      title,
      description,
      scope,
    })),
    operatorViews: app.operatorViews.map(({ id, title, description, scope, projection }) => ({
      id,
      title,
      description,
      scope,
      projection,
    })),
  });
}
