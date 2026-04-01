import type {
  AIContext,
  AIConfig,
  MemoryEntry,
  MemoryAccessor,
  RememberOptions,
  RecallOptions,
  AssembleContextOptions,
  AgentRunConfig,
  AgentRunResult,
  ThinkOptions,
  GenerateOptions,
} from "./types.js";
import { think, generate, thinkStream, generateStream } from "./think.js";
import { BuiltinMemoryBackend, createMemoryAccessor } from "./memory.js";
import { runAgentLoop } from "./agent-loop.js";

/**
 * Create a standalone AI context. Works without Capstan framework.
 *
 * Usage:
 * ```typescript
 * import { createAI, openaiProvider } from "@zauso-ai/capstan-ai";
 *
 * const ai = createAI({
 *   llm: openaiProvider({ apiKey: "..." }),
 *   defaultScope: { type: "user", id: "u-123" },
 * });
 *
 * const answer = await ai.think("What should I do?");
 * await ai.remember("User prefers dark mode");
 * ```
 */
export function createAI(config: AIConfig): AIContext {
  const embeddingConfig = config.memory?.embedding;
  const backend =
    config.memory?.backend ??
    new BuiltinMemoryBackend(
      embeddingConfig ? { embedding: embeddingConfig } : undefined,
    );

  const defaultScope = config.defaultScope ?? { type: "default", id: "default" };
  const defaultAccessor = createMemoryAccessor(defaultScope, backend);

  const ctx: AIContext = {
    async think<T = string>(prompt: string, opts?: ThinkOptions<T>): Promise<T> {
      return think(config.llm, prompt, opts);
    },

    async generate(prompt: string, opts?: GenerateOptions): Promise<string> {
      return generate(config.llm, prompt, opts);
    },

    thinkStream(prompt: string, opts?: Omit<ThinkOptions, "schema">) {
      return thinkStream(config.llm, prompt, opts);
    },

    generateStream(prompt: string, opts?: GenerateOptions) {
      return generateStream(config.llm, prompt, opts);
    },

    async remember(content: string, opts?: RememberOptions): Promise<string> {
      return defaultAccessor.remember(content, opts);
    },

    async recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]> {
      return defaultAccessor.recall(query, opts);
    },

    memory: {
      about(type: string, id: string): MemoryAccessor {
        return createMemoryAccessor({ type, id }, backend);
      },

      async forget(entryId: string): Promise<boolean> {
        return backend.remove(entryId);
      },

      async assembleContext(opts: AssembleContextOptions): Promise<string> {
        return defaultAccessor.assembleContext(opts);
      },
    },

    agent: {
      async run(runConfig: AgentRunConfig): Promise<AgentRunResult> {
        return runAgentLoop(config.llm, runConfig, runConfig.tools ?? []);
      },
    },
  };

  return ctx;
}
