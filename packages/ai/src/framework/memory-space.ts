import {
  dedupeContracts,
  frameworkError,
  freezeDeep,
  normalizeId,
  normalizeInteger,
  normalizeJsonObject,
  normalizeScore,
  normalizeStringList,
  normalizeText,
  normalizeTitle,
  stableJson,
} from "./shared.js";
import type {
  AgentMemoryGraphBindingContract,
  AgentMemoryGraphBindingInput,
  AgentMemoryPromotionContract,
  AgentMemoryPromotionInput,
  AgentMemoryRetentionContract,
  AgentMemoryRetentionInput,
  AgentMemoryRetrievalContract,
  AgentMemoryRetrievalInput,
  AgentMemorySpaceContract,
  AgentMemorySpaceInput,
} from "./types.js";

function normalizePromotion(input: AgentMemoryPromotionInput | undefined): AgentMemoryPromotionContract {
  if (input === undefined) {
    return freezeDeep({ mode: "manual" });
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "memory_space.promotion must be a plain object", "memory_space.promotion");
  }

  const mode = input.mode ?? "manual";
  if (!["manual", "verified", "automatic"].includes(mode)) {
    throw frameworkError("invalid_promotion_mode", "memory_space.promotion.mode is not supported", "memory_space.promotion.mode");
  }

  const normalized: {
    mode: AgentMemoryPromotionContract["mode"];
    minConfidence?: number;
  } = { mode };
  if (input.minConfidence !== undefined) {
    normalized.minConfidence = normalizeScore(
      input.minConfidence,
      "memory_space.promotion.minConfidence",
      0,
    );
  }

  return freezeDeep(normalized);
}

function normalizeRetention(input: AgentMemoryRetentionInput | undefined): AgentMemoryRetentionContract {
  if (input === undefined) {
    return freezeDeep({ mode: "session" });
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "memory_space.retention must be a plain object", "memory_space.retention");
  }

  const mode = input.mode ?? "session";
  if (!["session", "ttl", "forever"].includes(mode)) {
    throw frameworkError("invalid_retention_mode", "memory_space.retention.mode is not supported", "memory_space.retention.mode");
  }

  const normalized: {
    mode: AgentMemoryRetentionContract["mode"];
    ttlDays?: number;
    maxItems?: number;
  } = { mode };
  if (input.ttlDays !== undefined) {
    normalized.ttlDays = normalizeInteger(
      input.ttlDays,
      "memory_space.retention.ttlDays",
      { min: 1 },
    );
  }
  if (input.maxItems !== undefined) {
    normalized.maxItems = normalizeInteger(
      input.maxItems,
      "memory_space.retention.maxItems",
      { min: 1 },
    );
  }
  if (mode === "ttl" && normalized.ttlDays === undefined) {
    throw frameworkError(
      "missing_ttl",
      "memory_space.retention.ttlDays is required when mode is ttl",
      "memory_space.retention.ttlDays",
    );
  }

  return freezeDeep(normalized);
}

function normalizeRetrieval(input: AgentMemoryRetrievalInput | undefined): AgentMemoryRetrievalContract {
  if (input === undefined) {
    return freezeDeep({ strategy: "recent_first", maxItems: 6, minScore: 0 });
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "memory_space.retrieval must be a plain object", "memory_space.retrieval");
  }

  const strategy = input.strategy ?? "recent_first";
  if (!["scope_first", "recent_first", "priority_first"].includes(strategy)) {
    throw frameworkError(
      "invalid_retrieval_strategy",
      "memory_space.retrieval.strategy is not supported",
      "memory_space.retrieval.strategy",
    );
  }

  return freezeDeep({
    strategy,
    maxItems: normalizeInteger(input.maxItems ?? 6, "memory_space.retrieval.maxItems", { min: 1 }),
    minScore: normalizeScore(input.minScore, "memory_space.retrieval.minScore", 0),
  });
}

function normalizeGraphBinding(input: AgentMemoryGraphBindingInput | undefined): AgentMemoryGraphBindingContract {
  if (input === undefined) {
    return freezeDeep({ enabled: true, nodeKinds: Object.freeze([]) as readonly string[] });
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError(
      "invalid_type",
      "memory_space.graphBinding must be a plain object",
      "memory_space.graphBinding",
    );
  }

  return freezeDeep({
    enabled: input.enabled ?? true,
    nodeKinds: normalizeStringList(
      input.nodeKinds,
      "memory_space.graphBinding.nodeKinds",
      { mode: "id" },
    ),
  });
}

function normalizeMemorySpaceInput(input: AgentMemorySpaceInput): AgentMemorySpaceContract {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw frameworkError("invalid_type", "memory_space must be a plain object", "memory_space");
  }

  const id = normalizeId(input.id, "memory_space.id");
  const scope = input.scope;
  if (!["run", "project", "resource", "entity", "capability", "workflow", "policy", "custom"].includes(scope)) {
    throw frameworkError("invalid_memory_scope", "memory_space.scope is not supported", "memory_space.scope");
  }

  const metadata = normalizeJsonObject(input.metadata, "memory_space.metadata");

  return freezeDeep({
    kind: "memory_space",
    id,
    title: normalizeTitle(input.title, id, "memory_space.title"),
    description: normalizeText(input.description, "memory_space.description"),
    tags: normalizeStringList(input.tags, "memory_space.tags"),
    ...(metadata === undefined ? {} : { metadata }),
    scope,
    recordKinds: normalizeStringList(input.recordKinds, "memory_space.recordKinds", { mode: "id" }),
    promotion: normalizePromotion(input.promotion),
    retention: normalizeRetention(input.retention),
    retrieval: normalizeRetrieval(input.retrieval),
    graphBinding: normalizeGraphBinding(input.graphBinding),
  });
}

export function defineMemorySpace(input: AgentMemorySpaceInput): AgentMemorySpaceContract {
  return normalizeMemorySpaceInput(input);
}

export function dedupeMemorySpaces(
  items: readonly AgentMemorySpaceInput[],
): readonly AgentMemorySpaceContract[] {
  return dedupeContracts("memory_space", items.map((item) => normalizeMemorySpaceInput(item)));
}

export function memorySpaceSignature(input: AgentMemorySpaceInput): string {
  return stableJson(normalizeMemorySpaceInput(input));
}
