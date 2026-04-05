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
  AgentOperatorActionKind,
  AgentOperatorViewContract,
  AgentOperatorViewFilterContract,
  AgentOperatorViewFilterInput,
  AgentOperatorViewInput,
} from "./types.js";

const OPERATOR_ACTIONS = new Set<AgentOperatorActionKind>([
  "pause",
  "resume",
  "retry",
  "cancel",
  "approve",
  "deny",
  "request_input",
  "open_artifact",
]);

function emptyFilters(): AgentOperatorViewFilterContract {
  return freezeDeep({
    capabilityIds: Object.freeze([]) as readonly string[],
    workflowIds: Object.freeze([]) as readonly string[],
    policyIds: Object.freeze([]) as readonly string[],
    memorySpaceIds: Object.freeze([]) as readonly string[],
    nodeKinds: Object.freeze([]) as readonly string[],
    artifactKinds: Object.freeze([]) as readonly string[],
  });
}

function normalizeFilters(input: AgentOperatorViewFilterInput | undefined): AgentOperatorViewFilterContract {
  if (input === undefined) {
    return emptyFilters();
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "operator_view.filters must be a plain object", "operator_view.filters");
  }

  const text = input.text === undefined
    ? undefined
    : normalizeText(input.text, "operator_view.filters.text");

  return freezeDeep({
    capabilityIds: normalizeStringList(
      input.capabilityIds,
      "operator_view.filters.capabilityIds",
      { mode: "id" },
    ),
    workflowIds: normalizeStringList(
      input.workflowIds,
      "operator_view.filters.workflowIds",
      { mode: "id" },
    ),
    policyIds: normalizeStringList(
      input.policyIds,
      "operator_view.filters.policyIds",
      { mode: "id" },
    ),
    memorySpaceIds: normalizeStringList(
      input.memorySpaceIds,
      "operator_view.filters.memorySpaceIds",
      { mode: "id" },
    ),
    nodeKinds: normalizeStringList(input.nodeKinds, "operator_view.filters.nodeKinds", { mode: "id" }),
    artifactKinds: normalizeStringList(
      input.artifactKinds,
      "operator_view.filters.artifactKinds",
      { mode: "id" },
    ),
    ...(text === undefined ? {} : { text }),
  });
}

function normalizeActions(value: readonly string[] | undefined): readonly AgentOperatorActionKind[] {
  const actions = normalizeStringList(value, "operator_view.actions", { mode: "id" });
  for (const action of actions) {
    if (!OPERATOR_ACTIONS.has(action as AgentOperatorActionKind)) {
      throw frameworkError("invalid_operator_action", `operator_view.actions contains unsupported action "${action}"`, "operator_view.actions");
    }
  }
  return actions as readonly AgentOperatorActionKind[];
}

function normalizeOperatorViewInput(input: AgentOperatorViewInput): AgentOperatorViewContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "operator_view must be a plain object", "operator_view");
  }

  const id = normalizeId(input.id, "operator_view.id");
  const scope = input.scope;
  if (!["run", "project", "resource", "entity", "capability", "workflow", "policy", "custom"].includes(scope)) {
    throw frameworkError("invalid_view_scope", "operator_view.scope is not supported", "operator_view.scope");
  }

  const projection = input.projection ?? "run_timeline";
  if (!["run_timeline", "task_board", "approval_inbox", "artifact_feed", "custom"].includes(projection)) {
    throw frameworkError("invalid_projection", "operator_view.projection is not supported", "operator_view.projection");
  }

  const customProjection = projection === "custom"
    ? normalizeText(input.customProjection, "operator_view.customProjection")
    : undefined;

  const metadata = normalizeJsonObject(input.metadata, "operator_view.metadata");

  return freezeDeep({
    kind: "operator_view",
    id,
    title: normalizeTitle(input.title, id, "operator_view.title"),
    description: normalizeText(input.description, "operator_view.description"),
    tags: normalizeStringList(input.tags, "operator_view.tags"),
    ...(metadata === undefined ? {} : { metadata }),
    scope,
    projection,
    ...(customProjection === undefined ? {} : { customProjection }),
    filters: normalizeFilters(input.filters),
    actions: normalizeActions(input.actions),
  });
}

export function defineOperatorView(input: AgentOperatorViewInput): AgentOperatorViewContract {
  return normalizeOperatorViewInput(input);
}

export function dedupeOperatorViews(
  items: readonly AgentOperatorViewInput[],
): readonly AgentOperatorViewContract[] {
  return dedupeContracts("operator_view", items.map((item) => normalizeOperatorViewInput(item)));
}

export function operatorViewSignature(input: AgentOperatorViewInput): string {
  return stableJson(normalizeOperatorViewInput(input));
}
