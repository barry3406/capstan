import type { AgentRunResult, AgentSkill, LLMProvider } from "../types.js";

// === Trajectory Step ===
export interface TrajectoryStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  status: "success" | "error";
  iteration: number;
}

// === Experience: structured run trajectory ===
export interface Experience {
  id: string;
  goal: string;
  outcome: "success" | "failure" | "partial";
  trajectory: TrajectoryStep[];
  iterations: number;
  tokenUsage: number;
  duration: number;
  skillsUsed: string[];
  recordedAt: string;
  metadata?: Record<string, unknown> | undefined;
}

// === Strategy: distilled from experiences ===
export interface Strategy {
  id: string;
  content: string;
  source: string[];
  utility: number;
  applications: number;
  createdAt: string;
  updatedAt: string;
}

// === Distiller interface ===
export interface Distiller {
  distill(experiences: Experience[]): Promise<Omit<Strategy, "id" | "createdAt" | "updatedAt">[]>;
  consolidate(strategies: Strategy[]): Promise<Omit<Strategy, "id" | "createdAt" | "updatedAt">[]>;
}

// === Experience Query ===
export interface ExperienceQuery {
  goal?: string | undefined;
  outcome?: "success" | "failure" | "partial" | undefined;
  limit?: number | undefined;
  since?: string | undefined;
}

// === Pruning Config ===
export interface PruningConfig {
  maxStrategies?: number | undefined;
  minUtility?: number | undefined;
  maxAgeDays?: number | undefined;
}

// === Skill Promotion Config ===
export interface SkillPromotionConfig {
  enabled?: boolean | undefined;
  minApplications?: number | undefined;
  minUtility?: number | undefined;
}

// === Evolution Stats ===
export interface EvolutionStats {
  totalExperiences: number;
  totalStrategies: number;
  totalEvolvedSkills: number;
  averageUtility: number;
}

// === Evolution Store ===
export interface EvolutionStore {
  recordExperience(exp: Omit<Experience, "id" | "recordedAt">): Promise<string>;
  queryExperiences(query: ExperienceQuery): Promise<Experience[]>;
  storeStrategy(strategy: Omit<Strategy, "id" | "createdAt" | "updatedAt">): Promise<string>;
  queryStrategies(query: string, k: number): Promise<Strategy[]>;
  updateStrategyUtility(id: string, delta: number): Promise<void>;
  incrementStrategyApplications(id: string): Promise<void>;
  storeSkill(skill: AgentSkill): Promise<string>;
  querySkills(query: string, k: number): Promise<AgentSkill[]>;
  pruneStrategies(config: PruningConfig): Promise<number>;
  getStats(): Promise<EvolutionStats>;
}

// === Evolution Config ===
export interface EvolutionConfig {
  store: EvolutionStore;
  capture?: "every-run" | "on-failure" | "on-success" | ((result: AgentRunResult) => boolean) | undefined;
  distillation?: "post-run" | "manual" | undefined;
  distiller?: Distiller | undefined;
  pruning?: PruningConfig | undefined;
  skillPromotion?: SkillPromotionConfig | undefined;
}
