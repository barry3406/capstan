import { readFileSync } from "node:fs";
import { createSmartAgent, defineSkill, createActivateSkillTool } from "../packages/ai/src/index.js";
import { responsesProvider } from "../packages/agent/src/llm.js";
import type { AgentTool } from "../packages/ai/src/types.js";

const env: Record<string, string> = {};
for (const l of readFileSync(new URL("../.env.test", import.meta.url), "utf-8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const provider = responsesProvider({ apiKey: env.LLM_API_KEY!, baseUrl: env.LLM_BASE_URL!, model: env.LLM_MODEL!, reasoningEffort: env.LLM_REASONING_EFFORT });

const debugSkill = defineSkill({
  name: "debugging",
  description: "Systematic debugging methodology for finding and fixing errors",
  trigger: "when debugging errors, exceptions, or unexpected behavior",
  prompt: "Follow this debugging strategy:\n1. Reproduce...\n4. Verify with check_value\n5. Report",
});
const checkValueTool: AgentTool = {
  name: "check_value", description: "Check a value in the system for debugging purposes.",
  parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  async execute(args) { const key = args.key as string; return key === "config.timeout" ? { key, value: -1, note: "invalid" } : { key, value: "ok" }; },
};

// MIRRORS the framework smoke test EXACTLY: activate_skill added both manually AND via skills:
const agent = createSmartAgent({
  llm: provider,
  tools: [checkValueTool, createActivateSkillTool([debugSkill])],
  skills: [debugSkill],
  maxIterations: 15,
});

const result = await agent.run(
  "There is a bug: the system keeps timing out. Debug this issue. First activate the debugging skill to get guidance, then use check_value with key 'config.timeout' to investigate.",
);

console.log(`status=${result.status} iterations=${result.iterations}`);
for (const c of result.toolCalls) {
  console.log(`  TOOL ${c.tool}  args=${JSON.stringify(c.args)}  result=${JSON.stringify(c.result).slice(0, 120)}`);
}
const sc = result.toolCalls.find((c) => c.tool === "activate_skill");
console.log(`\nactivate_skill result.skill = ${JSON.stringify((sc?.result as any)?.skill)}`);
