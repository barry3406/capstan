import type {
  AutocompactConfig,
  LLMMessage,
  LLMProvider,
  MicrocompactConfig,
  SnipConfig,
} from "../types.js";

/* ------------------------------------------------------------------ */
/*  Token estimation                                                  */
/* ------------------------------------------------------------------ */

/**
 * Rough token estimate: sum all message content lengths and divide by 4.
 */
export function estimateTokens(messages: LLMMessage[]): number {
  if (messages.length === 0) return 0;
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
  }
  return Math.floor(chars / 4);
}

/* ------------------------------------------------------------------ */
/*  Snip — drop middle messages, keep system + tail                   */
/* ------------------------------------------------------------------ */

export interface SnipResult {
  messages: LLMMessage[];
  snippedCount: number;
}

/**
 * Keep the system prompt (if the first message has role "system") and the
 * last `preserveTail * 2` messages. Everything in between is removed, and a
 * system-role marker is inserted noting how many messages were dropped.
 */
export function snipMessages(
  messages: LLMMessage[],
  config: SnipConfig,
): SnipResult {
  const firstMessage = messages[0];
  const hasSystem = firstMessage !== undefined && firstMessage.role === "system";
  const systemMsg = hasSystem ? firstMessage : undefined;
  const body = hasSystem ? messages.slice(1) : messages;

  const tailCount = config.preserveTail * 2;

  // Nothing to snip — the body already fits in the tail
  if (body.length <= tailCount) {
    return { messages: [...messages], snippedCount: 0 };
  }

  const tail = tailCount > 0 ? body.slice(-tailCount) : [];
  const snippedCount = body.length - tail.length;

  const marker: LLMMessage = {
    role: "system",
    content: `[COMPACTED] ${snippedCount} earlier messages removed`,
  };

  const result: LLMMessage[] = [];
  if (systemMsg) result.push(systemMsg);
  result.push(marker);
  result.push(...tail);

  return { messages: result, snippedCount };
}

/* ------------------------------------------------------------------ */
/*  Microcompact — truncate verbose tool results outside tail         */
/* ------------------------------------------------------------------ */

export interface MicrocompactResult {
  messages: LLMMessage[];
  truncatedCount: number;
  charsFreed: number;
}

const TOOL_RESULT_PATTERN = /^Tool "/;

/**
 * Content-addressed hash (djb2) for microcompact caching.
 * No security concern — purely for dedup of truncated tool results.
 */
function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return `mc_${hash >>> 0}`;
}

/**
 * For messages outside the protected tail, truncate any content that
 * (a) looks like a tool result (`Tool "..." returned:`) and
 * (b) exceeds `maxToolResultChars`.
 *
 * System prompts are never truncated.
 *
 * When a `cache` map is provided, truncated results are stored keyed by
 * a content hash. On subsequent calls the cached truncation is reused
 * instead of re-scanning the message, avoiding redundant work across
 * iterations.
 */
export function microcompactMessages(
  messages: LLMMessage[],
  config: MicrocompactConfig,
  cache?: Map<string, string>,
): MicrocompactResult {
  const out: LLMMessage[] = [];
  let truncatedCount = 0;
  let charsFreed = 0;

  const protectedStart = messages.length - config.protectedTail;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;

    // Never truncate system messages or messages in protected tail
    if (m.role === "system" || i >= protectedStart) {
      out.push(m);
      continue;
    }

    // Check if this looks like a tool result and exceeds the limit
    if (
      TOOL_RESULT_PATTERN.test(m.content) &&
      m.content.includes("returned:") &&
      m.content.length > config.maxToolResultChars
    ) {
      // Check cache first
      const cacheKey = hashContent(m.content);
      const cached = cache?.get(cacheKey);
      if (cached) {
        out.push({ role: m.role, content: cached });
        truncatedCount++;
        charsFreed += m.content.length - cached.length;
        continue;
      }

      const truncated = m.content.slice(0, config.maxToolResultChars);
      const freed = m.content.length - config.maxToolResultChars;
      const result = `${truncated} [...truncated ${freed} chars]`;
      out.push({
        role: m.role,
        content: result,
      });
      truncatedCount++;
      charsFreed += freed;

      // Store in cache for future iterations
      cache?.set(cacheKey, result);
    } else {
      out.push(m);
    }
  }

  return { messages: out, truncatedCount, charsFreed };
}

/* ------------------------------------------------------------------ */
/*  Autocompact — LLM-driven summarization                           */
/* ------------------------------------------------------------------ */

export interface AutocompactResult {
  messages: LLMMessage[];
  memoryCandidates: string[];
  tokensFreed: number;
  failed?: boolean | undefined;
}

const AUTOCOMPACT_SYSTEM_PROMPT = `You are summarizing a conversation between a user and an agent.
Produce a JSON response with two fields:
1. "summary": A concise summary including the original goal, what was accomplished, what's in progress, key decisions, errors encountered.
2. "memories": An array of standalone observations worth remembering long-term. Only genuinely useful insights.`;

/**
 * Summarize the middle of a conversation using an LLM call, preserving the
 * system prompt and the last 4 messages. The summary replaces everything
 * in between as a system message prefixed with `[AUTOCOMPACT]`.
 *
 * On any failure (LLM error, invalid JSON) returns the original messages
 * with `failed: true`.
 */
export async function autocompact(
  llm: LLMProvider,
  messages: LLMMessage[],
  config: AutocompactConfig,
): Promise<AutocompactResult> {
  // Not enough messages to compact
  if (messages.length <= 5) {
    return {
      messages: [...messages],
      memoryCandidates: [],
      tokensFreed: 0,
    };
  }

  const firstMsg = messages[0];
  const hasSystem = firstMsg !== undefined && firstMsg.role === "system";
  const systemMsg = hasSystem ? firstMsg : undefined;
  const bodyStart = hasSystem ? 1 : 0;

  const last4 = messages.slice(-4);
  const middle = messages.slice(bodyStart, messages.length - 4);

  // Nothing in the middle to summarize
  if (middle.length === 0) {
    return {
      messages: [...messages],
      memoryCandidates: [],
      tokensFreed: 0,
    };
  }

  const tokensBefore = estimateTokens(messages);

  try {
    const conversationText = middle
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n\n");

    const response = await llm.chat(
      [
        { role: "system", content: AUTOCOMPACT_SYSTEM_PROMPT },
        { role: "user", content: conversationText },
      ],
      { temperature: 0 },
    );

    let parsed: { summary?: string; memories?: string[] };
    try {
      parsed = JSON.parse(response.content) as {
        summary?: string;
        memories?: string[];
      };
    } catch {
      return {
        messages: [...messages],
        memoryCandidates: [],
        tokensFreed: 0,
        failed: true,
      };
    }

    if (typeof parsed.summary !== "string") {
      return {
        messages: [...messages],
        memoryCandidates: [],
        tokensFreed: 0,
        failed: true,
      };
    }

    const summaryMessage: LLMMessage = {
      role: "system",
      content: `[AUTOCOMPACT]\n${parsed.summary}`,
    };

    const compacted: LLMMessage[] = [];
    if (systemMsg) compacted.push(systemMsg);
    compacted.push(summaryMessage);
    compacted.push(...last4);

    const tokensAfter = estimateTokens(compacted);
    const tokensFreed = Math.max(0, tokensBefore - tokensAfter);

    return {
      messages: compacted,
      memoryCandidates: Array.isArray(parsed.memories) ? parsed.memories : [],
      tokensFreed,
    };
  } catch {
    return {
      messages: [...messages],
      memoryCandidates: [],
      tokensFreed: 0,
      failed: true,
    };
  }
}
