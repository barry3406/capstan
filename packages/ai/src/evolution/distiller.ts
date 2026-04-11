import type { LLMProvider } from "../types.js";
import type { Distiller, Experience, Strategy } from "./types.js";

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const DISTILLATION_PROMPT = `You are an AI strategy distiller. Analyze the following agent execution traces and extract generalizable strategies that could help future runs.

For each strategy, produce a JSON object with:
- "content": a concise, actionable description of the strategy
- "source": a brief label indicating which experience(s) it was derived from

Return a JSON array of strategy objects. Example:
[
  {"content": "When file paths fail, check working directory first", "source": "file-ops-trace"},
  {"content": "Break multi-step tasks into subtasks with verification", "source": "complex-workflow-trace"}
]

Only output the JSON array, no other text.`;

export const CONSOLIDATION_PROMPT = `You are an AI strategy consolidator. You have a set of learned strategies that may overlap, contradict, or be redundant.

Your job:
1. Merge overlapping strategies into stronger, unified ones
2. Resolve contradictions by keeping the higher-utility version
3. Remove redundant strategies
4. Cap the total at 10 strategies maximum

For each consolidated strategy, produce a JSON object with:
- "content": the merged/refined strategy description
- "source": combined source labels from the originals

Return a JSON array of consolidated strategy objects. Only output the JSON array, no other text.`;

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

export function parseStrategies(raw: string): Array<{ content: string; source: string[] }> {
  if (!raw || raw.trim().length === 0) return [];

  // Strip markdown code fences if present
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    const result: Array<{ content: string; source: string[] }> = [];
    for (const item of parsed) {
      if (
        item != null &&
        typeof item === "object" &&
        "content" in item &&
        typeof (item as Record<string, unknown>).content === "string" &&
        "source" in item
      ) {
        const rawSource = (item as Record<string, unknown>).source;
        const source: string[] = Array.isArray(rawSource)
          ? rawSource.filter((s): s is string => typeof s === "string")
          : [typeof rawSource === "string" ? rawSource : ""];
        result.push({
          content: (item as Record<string, unknown>).content as string,
          source,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// LLM Distiller
// ---------------------------------------------------------------------------

export class LlmDistiller implements Distiller {
  constructor(private llm: LLMProvider) {}

  async distill(experiences: Experience[]): Promise<Omit<Strategy, "id" | "createdAt" | "updatedAt">[]> {
    if (experiences.length === 0) return [];

    try {
      const traceSummary = experiences.map((exp, i) =>
        `--- Trace ${i + 1} ---\nGoal: ${exp.goal}\nOutcome: ${exp.outcome}\nIterations: ${exp.iterations}\nTools: ${exp.trajectory.map((t) => t.tool).join(", ") || "none"}\nSkills: ${exp.skillsUsed.join(", ") || "none"}\nDuration: ${exp.duration}ms`
      ).join("\n\n");

      const response = await this.llm.chat([
        { role: "system", content: DISTILLATION_PROMPT },
        { role: "user", content: traceSummary },
      ]);

      const parsed = parseStrategies(response.content);
      return parsed.map((s) => ({
        content: s.content,
        source: s.source,
        utility: 0.5,
        applications: 0,
      }));
    } catch {
      return [];
    }
  }

  async consolidate(strategies: Strategy[]): Promise<Omit<Strategy, "id" | "createdAt" | "updatedAt">[]> {
    if (strategies.length === 0) return [];

    try {
      const strategySummary = strategies.map((s, i) =>
        `${i + 1}. [utility=${s.utility.toFixed(2)}, applications=${s.applications}] ${s.content} (source: ${s.source.join(", ")})`
      ).join("\n");

      const response = await this.llm.chat([
        { role: "system", content: CONSOLIDATION_PROMPT },
        { role: "user", content: strategySummary },
      ]);

      const parsed = parseStrategies(response.content);
      return parsed.map((s) => ({
        content: s.content,
        source: s.source,
        utility: 0.5,
        applications: 0,
      }));
    } catch {
      return [];
    }
  }
}
