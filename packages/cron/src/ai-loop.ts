/**
 * AI agent cron integration — submits scheduled runs into a harness runtime.
 *
 * The preferred path is to reuse a long-lived harness/runtime and let cron act
 * as a trigger adapter. When no runtime is provided, this file still falls
 * back to dynamically importing @zauso-ai/capstan-ai and bootstrapping a
 * harness on demand for compatibility.
 */

import { randomUUID } from "node:crypto";

import type {
  AgentCronConfig,
  AgentCronHarnessLike,
  AgentCronRunConfig,
  AgentCronTrigger,
  CronJobConfig,
} from "./types.js";

/**
 * Create a CronJobConfig that submits an AI agent run on each tick.
 *
 * Dynamically imports @zauso-ai/capstan-ai only when the caller has not
 * supplied their own harness runtime or harness factory.
 */
export function createAgentCron(config: AgentCronConfig): CronJobConfig {
  const shouldReuseHarness =
    config.runtime?.reuseHarness ??
    Boolean(config.runtime?.harness || config.runtime?.createHarness);

  let cachedHarness: AgentCronHarnessLike | null = config.runtime?.harness ?? null;
  let cachedHarnessPromise: Promise<AgentCronHarnessLike> | null =
    config.runtime?.harness != null ? Promise.resolve(config.runtime.harness) : null;
  let activeTicks = 0;
  let stopRequested = false;
  let stopCleanup: Promise<void> | null = null;

  const destroyHarness = async (harness: AgentCronHarnessLike | null): Promise<void> => {
    if (!harness || config.runtime?.harness) {
      return;
    }
    if (typeof harness.destroy === "function") {
      await harness.destroy();
    }
  };

  const createOwnedHarness = async (): Promise<AgentCronHarnessLike> => {
    if (config.runtime?.harness) {
      return config.runtime.harness;
    }

    if (config.runtime?.createHarness) {
      return config.runtime.createHarness();
    }

    const { createHarness } = await import("@zauso-ai/capstan-ai");
    if (config.llm == null) {
      throw new Error(
        "createAgentCron requires config.llm when no runtime.harness or runtime.createHarness is provided",
      );
    }

    const harnessConfig = {
      llm: config.llm,
      ...(config.harnessConfig ?? {}),
    };

    return createHarness(
      harnessConfig as Parameters<typeof createHarness>[0],
    ) as Promise<AgentCronHarnessLike>;
  };

  const acquireHarness = async (): Promise<{
    harness: AgentCronHarnessLike;
    destroyAfterUse: boolean;
  }> => {
    if (config.runtime?.harness) {
      return {
        harness: config.runtime.harness,
        destroyAfterUse: false,
      };
    }

    if (!shouldReuseHarness) {
      return {
        harness: await createOwnedHarness(),
        destroyAfterUse: true,
      };
    }

    if (!cachedHarnessPromise) {
      cachedHarnessPromise = createOwnedHarness()
        .then((harness) => {
          cachedHarness = harness;
          return harness;
        })
        .catch((error) => {
          cachedHarness = null;
          cachedHarnessPromise = null;
          throw error;
        });
    }

    const harness = cachedHarness ?? (await cachedHarnessPromise);
    cachedHarness = harness;
    return {
      harness,
      destroyAfterUse: false,
    };
  };

  const drainCachedHarness = async (): Promise<void> => {
    if (config.runtime?.harness) {
      return;
    }

    const pendingHarness = cachedHarnessPromise;
    const harness =
      cachedHarness ??
      (pendingHarness ? await pendingHarness.catch(() => null) : null);
    cachedHarness = null;
    cachedHarnessPromise = null;
    await destroyHarness(harness);
  };

  const requestStop = async (): Promise<void> => {
    stopRequested = true;
    if (!shouldReuseHarness || activeTicks > 0) {
      return;
    }
    if (!stopCleanup) {
      stopCleanup = drainCachedHarness().finally(() => {
        stopCleanup = null;
      });
    }
    await stopCleanup;
  };

  const buildRunConfig = (): AgentCronRunConfig => ({
    ...(config.run ?? {}),
    goal: typeof config.goal === "function" ? config.goal() : config.goal,
    maxIterations: config.run?.maxIterations ?? 20,
  });

  const buildTrigger = (): AgentCronTrigger => {
    const metadata = {
      tickId: `cron-tick-${randomUUID()}`,
      ...(config.triggerMetadata ?? {}),
    };

    return {
      type: "cron",
      source: config.name,
      firedAt: new Date().toISOString(),
      schedule: {
        name: config.name,
        pattern: config.cron,
        ...(config.timezone ? { timezone: config.timezone } : {}),
      },
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  };

  const base: CronJobConfig = {
    name: config.name,
    pattern: config.cron,
    ...(config.timezone ? { timezone: config.timezone } : {}),
    enabled: true,
    maxConcurrent: 1,
    async handler() {
      const { harness, destroyAfterUse } = await acquireHarness();
      const trigger = buildTrigger();
      activeTicks++;
      let failure: unknown;

      try {
        const started = await harness.startRun(buildRunConfig(), { trigger });
        config.onQueued?.({
          runId: started.runId,
          trigger,
        });

        const result = await started.result;
        config.onResult?.(result, {
          runId: started.runId,
          trigger,
        });
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        activeTicks--;
        try {
          if (destroyAfterUse) {
            await destroyHarness(harness);
          } else if (stopRequested && activeTicks === 0) {
            await requestStop();
          }
        } catch (cleanupError) {
          if (failure == null) {
            throw cleanupError;
          }
          config.onError?.(
            cleanupError instanceof Error
              ? cleanupError
              : new Error(String(cleanupError)),
          );
        }
      }
    },
    onStop() {
      return requestStop();
    },
  };

  if (config.onError) {
    base.onError = config.onError;
  }

  return base;
}
