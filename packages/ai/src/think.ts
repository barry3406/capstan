import type { LLMProvider, LLMMessage, ThinkOptions, GenerateOptions } from "./types.js";

export async function think<T = string>(llm: LLMProvider, prompt: string, opts?: ThinkOptions<T>): Promise<T> {
  const messages: LLMMessage[] = [];
  if (opts?.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: prompt });

  const llmOpts: Record<string, unknown> = {};
  if (opts?.model) llmOpts.model = opts.model;
  if (opts?.temperature !== undefined) llmOpts.temperature = opts.temperature;
  if (opts?.maxTokens) llmOpts.maxTokens = opts.maxTokens;
  if (opts?.schema) llmOpts.responseFormat = { type: "json_object" };

  const response = await llm.chat(messages, llmOpts as any);

  if (opts?.schema) {
    const parsed: unknown = JSON.parse(response.content);
    return opts.schema.parse(parsed);
  }

  return response.content as T;
}

export async function generate(llm: LLMProvider, prompt: string, opts?: GenerateOptions): Promise<string> {
  const messages: LLMMessage[] = [];
  if (opts?.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: prompt });

  const response = await llm.chat(messages, { model: opts?.model, temperature: opts?.temperature, maxTokens: opts?.maxTokens } as any);
  return response.content;
}

export async function* thinkStream(llm: LLMProvider, prompt: string, opts?: GenerateOptions): AsyncIterable<string> {
  if (!llm.stream) throw new Error("LLM provider does not support streaming");
  const messages: LLMMessage[] = [];
  if (opts?.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: prompt });
  for await (const chunk of llm.stream(messages, opts as any)) {
    if (chunk.content) yield chunk.content;
    if (chunk.done) return;
  }
}

export { thinkStream as generateStream };
