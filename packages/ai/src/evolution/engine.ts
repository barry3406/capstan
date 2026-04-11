import type { AgentRunResult, LLMProvider, PromptLayer } from "../types.js";
import type { EvolutionConfig, Experience, Strategy, TrajectoryStep } from "./types.js";
import { LlmDistiller } from "./distiller.js";

// ---------------------------------------------------------------------------
// buildExperience — structured experience from a run result
// ---------------------------------------------------------------------------

export function buildExperience(
  goal: string,
  result: AgentRunResult,
  startTime: number,
  skillsUsed: string[],
): Omit<Experience, "id" | "recordedAt"> {
  const outcome: Experience["outcome"] =
    result.status === "completed" ? "success" : result.status === "fatal" ? "failure" : "partial";

  const trajectory: TrajectoryStep[] = result.toolCalls.map((tc, i) => ({
    tool: tc.tool,
    args: (typeof tc.args === "object" && tc.args !== null ? tc.args : {}) as Record<string, unknown>,
    result: tc.result,
    status: tc.status === "error" ? "error" as const : "success" as const,
    iteration: tc.order ?? i,
  }));

  return {
    goal,
    outcome,
    trajectory,
    iterations: result.iterations,
    tokenUsage: 0,
    duration: Date.now() - startTime,
    skillsUsed,
  };
}

// ---------------------------------------------------------------------------
// shouldCapture — decide whether to record based on config
// ---------------------------------------------------------------------------

export function shouldCapture(config: EvolutionConfig, result: AgentRunResult): boolean {
  const success = result.status === "completed";
  if (typeof config.capture === "function") {
    return config.capture(result);
  }
  switch (config.capture) {
    case "every-run":
      return true;
    case "on-failure":
      return !success;
    case "on-success":
      return success;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// buildStrategyLayer — create a PromptLayer from learned strategies
// ---------------------------------------------------------------------------

export function buildStrategyLayer(strategies: Strategy[]): PromptLayer | null {
  if (strategies.length === 0) return null;

  const lines = strategies.map((s, i) => `${i + 1}. ${s.content}`);
  const content = `## Learned Strategies\nApply these strategies when relevant:\n${lines.join("\n")}`;

  return {
    id: "evolution-strategies",
    content,
    position: "append",
    priority: 80,
  };
}

// ---------------------------------------------------------------------------
// runPostRunEvolution — full post-run pipeline (fire-and-forget safe)
// ---------------------------------------------------------------------------

export async function runPostRunEvolution(
  config: EvolutionConfig,
  llm: LLMProvider,
  goal: string,
  result: AgentRunResult,
  startTime: number,
  skillsUsed: string[],
  retrievedStrategies: Strategy[],
): Promise<void> {
  try {
    const store = config.store;

    // 1. Record experience if shouldCapture
    if (shouldCapture(config, result)) {
      const exp = buildExperience(goal, result, startTime, skillsUsed);
      await store.recordExperience(exp);
    }

    // 2. Update utility of retrieved strategies
    const success = result.status === "completed";
    for (const strat of retrievedStrategies) {
      const delta = success ? 0.1 : -0.05;
      await store.updateStrategyUtility(strat.id, delta);
      await store.incrementStrategyApplications(strat.id);
    }

    // 3. Distill if configured and enough experiences
    if (config.distillation === "post-run") {
      const experiences = await store.queryExperiences({ limit: 10 });
      if (experiences.length >= 3) {
        const distiller = new LlmDistiller(llm);
        const newStrategies = await distiller.distill(experiences);
        for (const s of newStrategies) {
          await store.storeStrategy(s);
        }
      }
    }

    // 4. Prune if configured
    if (config.pruning) {
      await store.pruneStrategies(config.pruning);
    }

    // 5. Skill promotion
    const minUtility = config.skillPromotion?.minUtility ?? 0.7;
    const minApplications = config.skillPromotion?.minApplications ?? 5;
    const currentStrategies = await store.queryStrategies("", 100);
    const existingSkills = await store.querySkills("", 100);
    const promotedNames = new Set(existingSkills.map((s) => s.name));

    for (const strat of currentStrategies) {
      const slugified = `skill-${strat.id}`;
      if (strat.utility >= minUtility && strat.applications >= minApplications && !promotedNames.has(slugified)) {
        await store.storeSkill({
          name: slugified,
          description: strat.content,
          trigger: strat.content.split(".")[0] ?? strat.content.slice(0, 60),
          prompt: strat.content,
          source: "evolved",
          utility: strat.utility,
        });
      }
    }
  } catch {
    // Evolution failure must NEVER crash the agent — silently swallow
  }
}
