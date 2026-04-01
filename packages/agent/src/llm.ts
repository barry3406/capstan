// ---------------------------------------------------------------------------
// LLM provider adapter interface and built-in implementations
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | undefined;
  finishReason?: string | undefined;
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  responseFormat?: Record<string, unknown>;
}

export interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  stream?(
    messages: LLMMessage[],
    options?: LLMOptions,
  ): AsyncIterable<LLMStreamChunk>;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider
// ---------------------------------------------------------------------------

export function openaiProvider(config: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}): LLMProvider {
  const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  const defaultModel = config.model ?? "gpt-4o";

  return {
    name: "openai",

    async chat(messages, options) {
      const body: Record<string, unknown> = {
        model: options?.model ?? defaultModel,
        messages: options?.systemPrompt
          ? [{ role: "system", content: options.systemPrompt }, ...messages]
          : messages,
      };
      if (options?.temperature !== undefined)
        body["temperature"] = options.temperature;
      if (options?.maxTokens !== undefined)
        body["max_tokens"] = options.maxTokens;
      if (options?.responseFormat)
        body["response_format"] = {
          type: "json_schema",
          json_schema: {
            schema: options.responseFormat,
            name: "response",
            strict: true,
          },
        };

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok)
        throw new Error(`LLM error ${res.status}: ${await res.text()}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      return {
        content: data.choices?.[0]?.message?.content ?? "",
        model: data.model ?? defaultModel,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        finishReason: data.choices?.[0]?.finish_reason,
      };
    },

    async *stream(messages, options) {
      const body: Record<string, unknown> = {
        model: options?.model ?? defaultModel,
        messages: options?.systemPrompt
          ? [{ role: "system", content: options.systemPrompt }, ...messages]
          : messages,
        stream: true,
      };
      if (options?.temperature !== undefined)
        body["temperature"] = options.temperature;
      if (options?.maxTokens !== undefined)
        body["max_tokens"] = options.maxTokens;

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`LLM error ${res.status}`);
      if (!res.body) throw new Error("No body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const d = line.slice(6).trim();
          if (d === "[DONE]") {
            yield { content: "", done: true };
            return;
          }
          try {
            const p = JSON.parse(d);
            const c = p.choices?.[0]?.delta?.content ?? "";
            if (c) yield { content: c, done: false };
          } catch {
            // skip malformed chunks
          }
        }
      }
      yield { content: "", done: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Anthropic provider
// ---------------------------------------------------------------------------

export function anthropicProvider(config: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}): LLMProvider {
  const baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
  const defaultModel = config.model ?? "claude-sonnet-4-20250514";

  return {
    name: "anthropic",

    async chat(messages, options) {
      const sys =
        options?.systemPrompt ??
        messages.find((m) => m.role === "system")?.content;
      const msgs = messages.filter((m) => m.role !== "system");
      const body: Record<string, unknown> = {
        model: options?.model ?? defaultModel,
        messages: msgs,
        max_tokens: options?.maxTokens ?? 4096,
      };
      if (sys) body["system"] = sys;
      if (options?.temperature !== undefined)
        body["temperature"] = options.temperature;

      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok)
        throw new Error(
          `Anthropic error ${res.status}: ${await res.text()}`,
        );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text =
        data.content?.find((b: any) => b.type === "text")?.text ?? "";
      return {
        content: text,
        model: data.model ?? defaultModel,
        usage: data.usage
          ? {
              promptTokens: data.usage.input_tokens,
              completionTokens: data.usage.output_tokens,
              totalTokens:
                (data.usage.input_tokens ?? 0) +
                (data.usage.output_tokens ?? 0),
            }
          : undefined,
        finishReason: data.stop_reason,
      };
    },
  };
}
