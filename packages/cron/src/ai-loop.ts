/**
 * AI agent loop integration — wraps createHarness + runAgentLoop into a cron job.
 *
 * Usage:
 * ```typescript
 * import { createCronRunner } from "@zauso-ai/capstan-cron";
 * import { createAgentCron } from "@zauso-ai/capstan-cron";
 *
 * const runner = createCronRunner();
 * runner.add(createAgentCron({
 *   cron: "0 *\/2 * * *",   // every 2 hours
 *   name: "price-monitor",
 *   goal: "Check competitor prices on example.com and save to workspace/prices.json",
 *   llm: myProvider,
 *   harnessConfig: {
 *     sandbox: { browser: true, fs: { rootDir: "./workspace" } },
 *     verify: { enabled: true },
 *   },
 * }));
 * runner.start();
 * ```
 */

import type { CronJobConfig, AgentCronConfig } from "./types.js";

/**
 * Create a CronJobConfig that runs an AI agent loop on each tick.
 *
 * Dynamically imports @zauso-ai/capstan-ai to avoid hard dependency.
 */
export function createAgentCron(config: AgentCronConfig): CronJobConfig {
  const base: CronJobConfig = {
    name: config.name,
    pattern: config.cron,
    enabled: true,
    maxConcurrent: 1,
    async handler() {
      // Dynamic import — capstan-ai is a peer dependency
      const { createHarness } = await import("@zauso-ai/capstan-ai");

      const harnessConfig = {
        llm: config.llm,
        ...(config.harnessConfig ?? {}),
      };

      const harness = await createHarness(harnessConfig as Parameters<typeof createHarness>[0]);

      try {
        const goal =
          typeof config.goal === "function" ? config.goal() : config.goal;

        const result = await harness.run({
          goal,
          maxIterations: 20,
        });

        if (config.onResult) {
          config.onResult(result);
        }
      } finally {
        await harness.destroy();
      }
    },
  };
  if (config.onError) base.onError = config.onError;
  return base;
}
