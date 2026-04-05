import {
  dedupeContracts,
  frameworkError,
  freezeDeep,
  normalizeId,
  normalizeInteger,
  normalizeJsonObject,
  normalizeStringList,
  normalizeText,
  normalizeTitle,
  stableJson,
} from "./shared.js";
import type {
  AgentWorkflowCompletionContract,
  AgentWorkflowCompletionInput,
  AgentWorkflowContract,
  AgentWorkflowInput,
  AgentWorkflowRetryContract,
  AgentWorkflowRetryInput,
  AgentWorkflowStageContract,
  AgentWorkflowStageInput,
  AgentWorkflowTriggerContract,
  AgentWorkflowTriggerInput,
} from "./types.js";

function normalizeStage(input: AgentWorkflowStageInput, path: string): AgentWorkflowStageContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", `${path} must be a plain object`, path);
  }

  const id = normalizeId(input.id, `${path}.id`);
  const next = normalizeStringList(input.next, `${path}.next`, { mode: "id" });
  const terminal = input.terminal ?? false;

  if (terminal && next.length > 0) {
    throw frameworkError(
      "invalid_stage_transition",
      `${path} cannot be terminal and reference next stages`,
      path,
    );
  }

  const metadata = normalizeJsonObject(input.metadata, `${path}.metadata`);

  return freezeDeep({
    id,
    capability: normalizeId(input.capability, `${path}.capability`),
    description: normalizeText(input.description, `${path}.description`),
    next,
    terminal,
    ...(metadata === undefined ? {} : { metadata }),
  });
}

function normalizeTrigger(input: AgentWorkflowTriggerInput, path: string): AgentWorkflowTriggerContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", `${path} must be a plain object`, path);
  }

  const type = input.type;
  if (!["manual", "cron", "event", "webhook", "queue"].includes(type)) {
    throw frameworkError("invalid_trigger_type", `${path}.type is not supported`, `${path}.type`);
  }

  const metadata = normalizeJsonObject(input.metadata, `${path}.metadata`);
  const normalized: {
    type: AgentWorkflowTriggerContract["type"];
    schedule?: string;
    event?: string;
    source?: string;
    queue?: string;
    metadata?: AgentWorkflowTriggerContract["metadata"];
  } = {
    type,
    ...(metadata === undefined ? {} : { metadata }),
  };

  if (type === "cron") {
    normalized.schedule = normalizeText(input.schedule, `${path}.schedule`);
  }
  if (type === "event") {
    normalized.event = normalizeText(input.event, `${path}.event`);
  }
  if (type === "webhook") {
    normalized.source = normalizeText(input.source, `${path}.source`);
  }
  if (type === "queue") {
    normalized.queue = normalizeText(input.queue, `${path}.queue`);
  }

  return freezeDeep(normalized);
}

function normalizeRetry(input: AgentWorkflowRetryInput | undefined): AgentWorkflowRetryContract {
  if (input === undefined) {
    return freezeDeep({ maxAttempts: 1, backoffMs: 0 });
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "workflow.retry must be a plain object", "workflow.retry");
  }

  return freezeDeep({
    maxAttempts: normalizeInteger(input.maxAttempts ?? 1, "workflow.retry.maxAttempts", { min: 1 }),
    backoffMs: normalizeInteger(input.backoffMs ?? 0, "workflow.retry.backoffMs", { min: 0 }),
  });
}

function normalizeCompletion(input: AgentWorkflowCompletionInput | undefined): AgentWorkflowCompletionContract {
  if (input === undefined) {
    return freezeDeep({ mode: "final_stage" });
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "workflow.completion must be a plain object", "workflow.completion");
  }

  const mode = input.mode ?? "final_stage";
  if (!["final_stage", "signal", "operator", "custom"].includes(mode)) {
    throw frameworkError(
      "invalid_completion_mode",
      "workflow.completion.mode is not supported",
      "workflow.completion.mode",
    );
  }

  const normalized: {
    mode: AgentWorkflowCompletionContract["mode"];
    signal?: string;
    description?: string;
  } = { mode };
  if (mode === "signal") {
    normalized.signal = normalizeId(input.signal, "workflow.completion.signal");
  }
  if (input.description !== undefined) {
    normalized.description = normalizeText(input.description, "workflow.completion.description");
  }

  return freezeDeep(normalized);
}

function normalizeWorkflowInput(input: AgentWorkflowInput): AgentWorkflowContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "workflow must be a plain object", "workflow");
  }

  const id = normalizeId(input.id, "workflow.id");
  const stages = dedupeContracts(
    "workflow_stage",
    input.stages.map((stage, index) => normalizeStage(stage, `workflow.stages[${index}]`)),
  );

  if (stages.length === 0) {
    throw frameworkError(
      "missing_stages",
      "workflow.stages must contain at least one stage",
      "workflow.stages",
    );
  }

  const stageCatalog = new Set(stages.map((stage) => stage.id));
  for (const stage of stages) {
    for (const next of stage.next) {
      if (!stageCatalog.has(next)) {
        throw frameworkError(
          "missing_stage_reference",
          `workflow.stages.${stage.id}.next references unknown stage "${next}"`,
          `workflow.stages.${stage.id}.next`,
        );
      }
    }
  }

  const concurrency = input.concurrency ?? "enqueue";
  if (!["enqueue", "replace", "skip", "parallel"].includes(concurrency)) {
    throw frameworkError(
      "invalid_concurrency",
      "workflow.concurrency is not supported",
      "workflow.concurrency",
    );
  }

  const metadata = normalizeJsonObject(input.metadata, "workflow.metadata");

  return freezeDeep({
    kind: "workflow",
    id,
    title: normalizeTitle(input.title, id, "workflow.title"),
    description: normalizeText(input.description, "workflow.description"),
    tags: normalizeStringList(input.tags, "workflow.tags"),
    ...(metadata === undefined ? {} : { metadata }),
    entryCapability: normalizeId(input.entryCapability, "workflow.entryCapability"),
    stages,
    triggers: Object.freeze(
      (input.triggers ?? []).map((trigger, index) => normalizeTrigger(trigger, `workflow.triggers[${index}]`)),
    ) as readonly AgentWorkflowTriggerContract[],
    retry: normalizeRetry(input.retry),
    completion: normalizeCompletion(input.completion),
    concurrency,
    defaultPolicies: normalizeStringList(
      input.defaultPolicies,
      "workflow.defaultPolicies",
      { mode: "id" },
    ),
    defaultMemorySpaces: normalizeStringList(
      input.defaultMemorySpaces,
      "workflow.defaultMemorySpaces",
      { mode: "id" },
    ),
  });
}

export function defineWorkflow(input: AgentWorkflowInput): AgentWorkflowContract {
  return normalizeWorkflowInput(input);
}

export function dedupeWorkflows(
  items: readonly AgentWorkflowInput[],
): readonly AgentWorkflowContract[] {
  return dedupeContracts("workflow", items.map((item) => normalizeWorkflowInput(item)));
}

export function workflowSignature(input: AgentWorkflowInput): string {
  return stableJson(normalizeWorkflowInput(input));
}
