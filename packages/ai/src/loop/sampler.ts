import type {
  AgentLoopModelFinishReason,
  AgentLoopToolRequest,
  LLMMessage,
  LLMProvider,
  LLMResponse,
} from "../types.js";

export interface ModelSampleOutcome {
  content: string;
  toolRequests: AgentLoopToolRequest[];
  finishReason: AgentLoopModelFinishReason;
  usage?: LLMResponse["usage"] | undefined;
}

export async function sampleModel(
  llm: LLMProvider,
  messages: LLMMessage[],
): Promise<ModelSampleOutcome> {
  if (llm.stream) {
    let content = "";
    for await (const chunk of llm.stream(messages)) {
      if (chunk.done) {
        break;
      }
      content += chunk.content;
    }
    const toolRequests = parseToolRequests(content);
    return {
      content,
      toolRequests,
      finishReason: toolRequests.length > 0 ? "tool_use" : "stop",
    };
  }

  const response = await llm.chat(messages);
  const toolRequests = parseToolRequests(response.content);
  return {
    content: response.content,
    toolRequests,
    finishReason: normalizeFinishReason(response.finishReason, toolRequests.length > 0),
    ...(response.usage ? { usage: response.usage } : {}),
  };
}

export function parseToolRequests(content: string): AgentLoopToolRequest[] {
  const candidates = [content, ...extractFencedJson(content)];
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed === undefined) {
      continue;
    }
    const requests = normalizeToolRequests(parsed);
    if (requests.length > 0) {
      return requests;
    }
  }
  return [];
}

function normalizeToolRequests(value: unknown): AgentLoopToolRequest[] {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => normalizeSingleToolRequest(entry, index))
      .filter((entry): entry is AgentLoopToolRequest => entry != null);
  }

  if (isPlainObject(value) && Array.isArray(value.tools)) {
    return value.tools
      .map((entry, index) => normalizeSingleToolRequest(entry, index))
      .filter((entry): entry is AgentLoopToolRequest => entry != null);
  }

  const single = normalizeSingleToolRequest(value, 0);
  return single ? [single] : [];
}

function normalizeSingleToolRequest(
  value: unknown,
  index: number,
): AgentLoopToolRequest | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const name = typeof value.tool === "string" ? value.tool.trim() : "";
  const argsCandidate = isPlainObject(value.arguments)
    ? value.arguments
    : isPlainObject(value.args)
      ? value.args
      : undefined;
  if (!name || !argsCandidate) {
    return undefined;
  }

  return {
    id: `toolreq_${index}_${crypto.randomUUID()}`,
    name,
    args: cloneArgs(argsCandidate),
    order: index,
  };
}

function tryParseJson(content: string): unknown | undefined {
  const trimmed = content.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function extractFencedJson(content: string): string[] {
  const blocks = content.match(/```json\s*([\s\S]*?)```/gi) ?? [];
  return blocks
    .map((block) => block.replace(/^```json\s*/i, "").replace(/```$/i, "").trim())
    .filter(Boolean);
}

function normalizeFinishReason(
  finishReason: string | undefined,
  hasToolRequests: boolean,
): AgentLoopModelFinishReason {
  const normalized = finishReason?.trim().toLowerCase();
  if (hasToolRequests || normalized === "tool_use" || normalized === "tool") {
    return "tool_use";
  }
  if (
    normalized === "max_output_tokens" ||
    normalized === "max_tokens" ||
    normalized === "length"
  ) {
    return "max_output_tokens";
  }
  if (
    normalized === "context_limit" ||
    normalized === "prompt_too_long" ||
    normalized === "context_window_exceeded"
  ) {
    return "context_limit";
  }
  if (normalized === "error") {
    return "error";
  }
  return "stop";
}

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, cloneUnknown(value)]),
  );
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneUnknown);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneUnknown(nested)]),
    );
  }
  return value;
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
