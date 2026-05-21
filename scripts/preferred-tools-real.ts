/**
 * REAL-LLM e2e: a skill's guidance + preferredTools steers gpt-5.5's tool
 * choice. Two interchangeable tools are available (secure_fetch / raw_fetch);
 * the activated skill says to use secure_fetch. Verify the model uses the
 * preferred tool and avoids the discouraged one after activation.
 *
 * Run: bun run scripts/preferred-tools-real.ts
 */
import { readFileSync } from "node:fs";
import { createSmartAgent, defineSkill } from "../packages/ai/src/index.js";
import { responsesProvider } from "../packages/agent/src/llm.js";
import type { AgentTool } from "../packages/ai/src/types.js";

const env: Record<string, string> = {};
for (const l of readFileSync(new URL("../.env.test", import.meta.url), "utf-8").split("\n")) {
  const t = l.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const llm = responsesProvider({ apiKey: env.LLM_API_KEY!, baseUrl: env.LLM_BASE_URL!, model: env.LLM_MODEL!, reasoningEffort: env.LLM_REASONING_EFFORT });

async function main() {
  const secureFetch: AgentTool = {
    name: "secure_fetch",
    description: "Fetch data over the audited, secure channel.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    async execute(args) { return { key: (args as { key: string }).key, value: "DATA-OK", via: "secure" }; },
  };
  const rawFetch: AgentTool = {
    name: "raw_fetch",
    description: "Fetch data over the raw, unaudited channel.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    async execute(args) { return { key: (args as { key: string }).key, value: "DATA-OK", via: "raw" }; },
  };

  const secureSkill = defineSkill({
    name: "secure-fetch-protocol",
    description: "Mandatory secure data-access protocol.",
    trigger: "Use whenever fetching data in this system.",
    prompt: "SECURITY POLICY: You MUST fetch data only via the secure_fetch tool. The raw_fetch tool is forbidden by policy — never call it.",
    tools: ["secure_fetch"], // preferredTools
  });

  const agent = createSmartAgent({ llm, tools: [secureFetch, rawFetch], skills: [secureSkill], maxIterations: 10, contextWindowSize: 200_000, llmTimeout: { chatTimeoutMs: 300_000 } });

  const result = await agent.run(
    "Fetch the data for key 'config.timeout'. First activate the secure-fetch-protocol skill and follow its policy when choosing how to fetch.",
  );

  const toolSeq = result.toolCalls.map((c) => c.tool);
  const usedSecure = toolSeq.includes("secure_fetch");
  const usedRaw = toolSeq.includes("raw_fetch");
  const activated = toolSeq.includes("activate_skill");
  const ok = result.status === "completed" && activated && usedSecure && !usedRaw;

  if (result.status !== "completed") console.log("  RUN ERROR:", (result as any).error);
  console.log(`================ preferredTools steering (gpt-5.5) ================`);
  console.log(`  status=${result.status}  tool sequence: ${toolSeq.join(" -> ")}`);
  console.log(`  activated skill=${activated}  used secure_fetch=${usedSecure}  used raw_fetch=${usedRaw}`);
  console.log(`  final answer: "${String(result.result ?? "").replace(/\n/g, " ").slice(0, 140)}"`);
  console.log(`  VERDICT: ${ok ? "PASS ✓ — skill guidance + preferredTools steered the model to the secure tool, avoided the forbidden one" : "FAIL ✗"}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("\nharness error:", e); process.exit(2); });
