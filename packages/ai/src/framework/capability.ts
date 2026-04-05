import {
  dedupeContracts,
  frameworkError,
  freezeDeep,
  normalizeId,
  normalizeJsonObject,
  normalizeSchema,
  normalizeStringList,
  normalizeText,
  normalizeTitle,
  stableJson,
} from "./shared.js";
import type {
  AgentCapabilityContract,
  AgentCapabilityInput,
  AgentCapabilityVerificationContract,
  AgentCapabilityVerificationInput,
} from "./types.js";

function normalizeVerification(
  value: AgentCapabilityVerificationInput | undefined,
): AgentCapabilityVerificationContract | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw frameworkError(
      "invalid_type",
      "capability.verification must be a plain object",
      "capability.verification",
    );
  }

  const mode = value.mode ?? "assert";
  if (!["none", "assert", "human"].includes(mode)) {
    throw frameworkError(
      "invalid_verification_mode",
      "capability.verification.mode is not supported",
      "capability.verification.mode",
    );
  }

  const description = value.description === undefined
    ? undefined
    : normalizeText(value.description, "capability.verification.description");

  return freezeDeep({
    mode,
    ...(description === undefined ? {} : { description }),
    requiredArtifacts: normalizeStringList(
      value.requiredArtifacts,
      "capability.verification.requiredArtifacts",
      { mode: "id" },
    ),
  });
}

function normalizeCapabilityInput(input: AgentCapabilityInput): AgentCapabilityContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "capability must be a plain object", "capability");
  }

  const id = normalizeId(input.id, "capability.id");
  const metadata = normalizeJsonObject(input.metadata, "capability.metadata");

  return freezeDeep({
    kind: "capability",
    id,
    title: normalizeTitle(input.title, id, "capability.title"),
    description: normalizeText(input.description, "capability.description"),
    tags: normalizeStringList(input.tags, "capability.tags"),
    ...(metadata === undefined ? {} : { metadata }),
    ...(input.input === undefined ? {} : { input: normalizeSchema(input.input, "capability.input") }),
    ...(input.output === undefined ? {} : { output: normalizeSchema(input.output, "capability.output") }),
    tools: normalizeStringList(input.tools, "capability.tools", { mode: "id" }),
    tasks: normalizeStringList(input.tasks, "capability.tasks", { mode: "id" }),
    defaultPolicies: normalizeStringList(
      input.defaultPolicies,
      "capability.defaultPolicies",
      { mode: "id" },
    ),
    defaultMemorySpaces: normalizeStringList(
      input.defaultMemorySpaces,
      "capability.defaultMemorySpaces",
      { mode: "id" },
    ),
    artifactKinds: normalizeStringList(input.artifactKinds, "capability.artifactKinds", { mode: "id" }),
    operatorSignals: normalizeStringList(
      input.operatorSignals,
      "capability.operatorSignals",
      { mode: "id" },
    ),
    verification: normalizeVerification(input.verification),
  });
}

export function defineCapability(input: AgentCapabilityInput): AgentCapabilityContract {
  return normalizeCapabilityInput(input);
}

export function dedupeCapabilities(
  items: readonly AgentCapabilityInput[],
): readonly AgentCapabilityContract[] {
  return dedupeContracts("capability", items.map((item) => normalizeCapabilityInput(item)));
}

export function capabilitySignature(input: AgentCapabilityInput): string {
  return stableJson(normalizeCapabilityInput(input));
}
