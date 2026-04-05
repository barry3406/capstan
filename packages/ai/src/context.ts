import type {
  AIContext,
  AIConfig,
  AgentRunConfig,
  AgentRunResult,
  ThinkOptions,
  GenerateOptions,
} from "./types.js";
import { think, generate, thinkStream, generateStream } from "./think.js";
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
 * });
 *
 * const answer = await ai.think("What should I do?");
 * ```
 */
export function createAI(config: AIConfig): AIContext {
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

    agent: {
      async run(runConfig: AgentRunConfig): Promise<AgentRunResult> {
        return runAgentLoop(config.llm, runConfig, runConfig.tools ?? []);
      },
    },
  };

  return ctx;
}
