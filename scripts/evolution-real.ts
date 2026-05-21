/**
 * REAL-LLM e2e for the evolution -> skill auto-promotion chain with gpt-5.5.
 *
 * Chain: experiences --(gpt-5.5 LlmDistiller)--> strategies --(utility/applications
 * cross thresholds)--> promoted to an "evolved" skill --> usable as a skill.
 *
 * The DISTILLER step uses the real model (gpt-5.5); promotion is deterministic.
 * Run: bun run scripts/evolution-real.ts
 */
import { readFileSync } from "node:fs";
import { responsesProvider } from "../packages/agent/src/llm.js";
import { InMemoryEvolutionStore } from "../packages/ai/src/evolution/store-memory.js";
import { runPostRunEvolution } from "../packages/ai/src/evolution/engine.js";
import { createSkillTools } from "../packages/ai/src/skill-bundle.js";
import type { AgentRunResult } from "../packages/ai/src/types.js";
import type { EvolutionConfig } from "../packages/ai/src/evolution/types.js";

const env: Record<string, string> = {};
for (const l of readFileSync(new URL("../.env.test", import.meta.url), "utf-8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const llm = responsesProvider({ apiKey: env.LLM_API_KEY!, baseUrl: env.LLM_BASE_URL!, model: env.LLM_MODEL!, reasoningEffort: env.LLM_REASONING_EFFORT });
const completed: AgentRunResult = { result: "ok", iterations: 3, toolCalls: [], taskCalls: [], status: "completed" };

async function main() {
  const store = new InMemoryEvolutionStore();

  // 1. Seed >= 3 experiences (the raw material the distiller learns from).
  const experiences = [
    { goal: "Extract totals from a messy CSV", outcome: "success" as const, lesson: "validate delimiters first" },
    { goal: "Extract totals from a tab-separated file", outcome: "success" as const, lesson: "sniff the delimiter before parsing" },
    { goal: "Parse a semicolon CSV export", outcome: "success" as const, lesson: "never assume comma; detect the separator" },
  ];
  for (const e of experiences) {
    await store.recordExperience({
      goal: e.goal,
      outcome: e.outcome,
      trajectory: [{ tool: "read_file", args: {}, result: e.lesson, status: "success", iteration: 1 }],
      iterations: 2,
      tokenUsage: 500,
      duration: 1000,
      skillsUsed: [],
    });
  }
  console.log(`Seeded ${experiences.length} experiences.`);

  // 2. Distill with the REAL model (gpt-5.5 LlmDistiller, constructed internally).
  const distillCfg: EvolutionConfig = { store, capture: () => false, distillation: "post-run" };
  await runPostRunEvolution(distillCfg, llm, "Parse a CSV", completed, Date.now(), [], []);
  const strategies = await store.queryStrategies("", 100);
  console.log(`\ngpt-5.5 distilled ${strategies.length} strateg${strategies.length === 1 ? "y" : "ies"}:`);
  for (const s of strategies.slice(0, 3)) console.log(`  - "${s.content.slice(0, 90)}" (utility=${s.utility.toFixed(2)}, applications=${s.applications})`);

  // 3. Simulate the strategies being retrieved + applied (success bumps
  //    applications/utility), then promote when thresholds are crossed.
  const promoteCfg: EvolutionConfig = { store, capture: () => false, skillPromotion: { enabled: true, minUtility: 0.0, minApplications: 1 } };
  await runPostRunEvolution(promoteCfg, llm, "Parse a CSV again", completed, Date.now(), [], strategies);

  // 4. Verify auto-promotion produced evolved skills.
  const skills = await store.querySkills("", 100);
  const evolved = skills.filter((s) => s.source === "evolved");
  console.log(`\nPromoted to ${evolved.length} evolved skill(s):`);
  for (const sk of evolved.slice(0, 3)) console.log(`  - ${sk.name}: "${sk.prompt.slice(0, 80)}" (source=${sk.source})`);

  // 5. An evolved skill must be USABLE as a skill (activatable, returns guidance).
  let usable = false;
  if (evolved.length > 0) {
    const tools = createSkillTools([evolved[0]!]);
    const act = (await tools.find((t) => t.name === "activate_skill")!.execute({ skill_name: evolved[0]!.name })) as { skill?: string; guidance?: string };
    usable = act.skill === evolved[0]!.name && typeof act.guidance === "string" && act.guidance.length > 0;
  }

  const ok = strategies.length >= 1 && evolved.length >= 1 && usable;
  console.log(`\n================ EVOLUTION->SKILL chain (gpt-5.5 distiller) ================`);
  console.log(`  distilled strategies: ${strategies.length}  |  promoted evolved skills: ${evolved.length}  |  evolved skill usable: ${usable}`);
  console.log(`  VERDICT: ${ok ? "PASS ✓ — experiences -> (gpt-5.5) strategies -> auto-promoted skill -> usable" : "FAIL ✗"}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("\nharness error:", e); process.exit(2); });
