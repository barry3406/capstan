import type { AgentSkill } from "../types.js";
import type {
  Experience,
  ExperienceQuery,
  Strategy,
  EvolutionStore,
  EvolutionStats,
  PruningConfig,
} from "./types.js";

/**
 * In-memory evolution store for development and testing.
 *
 * All data lives in Maps/arrays and is lost when the process exits.
 */
export class InMemoryEvolutionStore implements EvolutionStore {
  private experiences: Map<string, Experience> = new Map();
  private strategies: Map<string, Strategy> = new Map();
  private skills: Map<string, AgentSkill & { id: string }> = new Map();

  async recordExperience(
    exp: Omit<Experience, "id" | "recordedAt">,
  ): Promise<string> {
    const id = `exp_${crypto.randomUUID()}`;
    const entry: Experience = {
      ...exp,
      id,
      recordedAt: new Date().toISOString(),
    };
    this.experiences.set(id, entry);
    return id;
  }

  async queryExperiences(query: ExperienceQuery): Promise<Experience[]> {
    let results = [...this.experiences.values()];

    if (query.outcome) {
      results = results.filter((e) => e.outcome === query.outcome);
    }
    if (query.since) {
      const since = query.since;
      results = results.filter((e) => e.recordedAt >= since);
    }
    if (query.goal) {
      const terms = query.goal
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 0);
      results = results.filter((e) => {
        const content = e.goal.toLowerCase();
        return terms.some((t) => content.includes(t));
      });
    }

    return results.slice(0, query.limit ?? 50);
  }

  async storeStrategy(
    s: Omit<Strategy, "id" | "createdAt" | "updatedAt">,
  ): Promise<string> {
    const id = `strat_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const entry: Strategy = { ...s, id, createdAt: now, updatedAt: now };
    this.strategies.set(id, entry);
    return id;
  }

  async queryStrategies(query: string, k: number): Promise<Strategy[]> {
    const all = [...this.strategies.values()];

    if (!query) {
      return all
        .sort((a, b) => b.utility - a.utility)
        .slice(0, k);
    }

    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 0);

    return all
      .map((s) => {
        const content = s.content.toLowerCase();
        const score =
          terms.filter((t) => content.includes(t)).length /
          Math.max(terms.length, 1);
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.s.utility - a.s.utility)
      .slice(0, k)
      .map((x) => x.s);
  }

  async updateStrategyUtility(id: string, delta: number): Promise<void> {
    const s = this.strategies.get(id);
    if (s) {
      s.utility = Math.max(0, Math.min(1, s.utility + delta));
      s.updatedAt = new Date().toISOString();
    }
  }

  async incrementStrategyApplications(id: string): Promise<void> {
    const s = this.strategies.get(id);
    if (s) {
      s.applications++;
      s.updatedAt = new Date().toISOString();
    }
  }

  async storeSkill(skill: AgentSkill): Promise<string> {
    const id = `skill_${crypto.randomUUID()}`;
    this.skills.set(id, { ...skill, id });
    return id;
  }

  async querySkills(query: string, k: number): Promise<AgentSkill[]> {
    const all = [...this.skills.values()];

    if (!query) {
      return all.slice(0, k);
    }

    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 0);

    return all
      .filter((s) => {
        const content =
          `${s.name} ${s.description} ${s.trigger}`.toLowerCase();
        return terms.some((t) => content.includes(t));
      })
      .slice(0, k);
  }

  async pruneStrategies(config: PruningConfig): Promise<number> {
    const before = this.strategies.size;

    // Remove below minUtility
    if (config.minUtility !== undefined) {
      const min = config.minUtility;
      for (const [id, s] of this.strategies) {
        if (s.utility < min) {
          this.strategies.delete(id);
        }
      }
    }

    // Cap at maxStrategies, keeping highest utility
    if (
      config.maxStrategies !== undefined &&
      this.strategies.size > config.maxStrategies
    ) {
      const sorted = [...this.strategies.values()].sort(
        (a, b) => b.utility - a.utility,
      );
      const keep = new Set(
        sorted.slice(0, config.maxStrategies).map((s) => s.id),
      );
      for (const id of this.strategies.keys()) {
        if (!keep.has(id)) {
          this.strategies.delete(id);
        }
      }
    }

    return before - this.strategies.size;
  }

  async getStats(): Promise<EvolutionStats> {
    const strategies = [...this.strategies.values()];
    const avgUtility =
      strategies.length > 0
        ? strategies.reduce((sum, s) => sum + s.utility, 0) / strategies.length
        : 0;

    return {
      totalExperiences: this.experiences.size,
      totalStrategies: this.strategies.size,
      totalEvolvedSkills: this.skills.size,
      averageUtility: avgUtility,
    };
  }
}
